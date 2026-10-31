use oxc_ast::ast::{
    Argument, Expression, IdentifierReference, ImportDeclarationSpecifier, ObjectProperty,
    ObjectPropertyKind, Program, PropertyKind, Statement,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{Scoping, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::LogicalOperator;

use crate::edit::{Edit, expand_removal_to_line};

use super::{import_analysis::is_compile_time_import, styled_jsx_helpers::js_string_literal};

pub(crate) fn optimize_cx_calls(
    program: &Program<'_>,
    scoping: &Scoping,
    source: &str,
    edits: &mut Vec<Edit>,
) {
    let cx_symbols = vindur_cx_symbols(program);
    let mut visitor = CxCallVisitor {
        scoping,
        cx_symbols: &cx_symbols,
        source,
        edits,
        optimized_calls: 0,
        inside_spread: false,
    };
    visitor.visit_program(program);
    // Other references are rejected before, so only calls that weren't optimized (and
    // `typeof cx`) keep the import
    let references = cx_symbols
        .iter()
        .map(|symbol| scoping.get_resolved_reference_ids(*symbol).len())
        .sum::<usize>();
    if references > 0 && references == visitor.optimized_calls {
        remove_cx_import(program, source, visitor.edits);
    }
}

pub(super) fn vindur_cx_symbols(program: &Program<'_>) -> Vec<SymbolId> {
    program
        .body
        .iter()
        .filter_map(|statement| {
            let Statement::ImportDeclaration(declaration) = statement else {
                return None;
            };
            (declaration.source.value.as_str() == "vindur").then_some(declaration)
        })
        .flat_map(|declaration| declaration.specifiers.iter().flatten())
        .filter_map(|specifier| {
            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                return None;
            };
            (specifier.imported.name().as_str() == "cx").then(|| specifier.local.symbol_id())
        })
        .collect()
}

struct CxCallVisitor<'a> {
    scoping: &'a Scoping,
    cx_symbols: &'a [SymbolId],
    source: &'a str,
    edits: &'a mut Vec<Edit>,
    optimized_calls: usize,
    // Other passes copy JSX spread source into `mergeClassNames([...])`, and the copy still
    // calls `cx`, so calls inside spreads don't count towards removing the import
    inside_spread: bool,
}

impl<'a> Visit<'a> for CxCallVisitor<'_> {
    fn visit_jsx_spread_attribute(&mut self, attribute: &oxc_ast::ast::JSXSpreadAttribute<'a>) {
        let inside_spread = self.inside_spread;
        self.inside_spread = true;
        walk::walk_jsx_spread_attribute(self, attribute);
        self.inside_spread = inside_spread;
    }

    fn visit_call_expression(&mut self, call: &oxc_ast::ast::CallExpression<'a>) {
        // Only calls of vindur's `cx` under its own name, a `cx` from another library may differ
        let Expression::Identifier(callee) = &call.callee else {
            walk::walk_call_expression(self, call);
            return;
        };
        let is_vindur_cx = callee.name.as_str() == "cx"
            && self
                .scoping
                .get_reference(callee.reference_id())
                .symbol_id()
                .is_some_and(|symbol| self.cx_symbols.contains(&symbol));
        if !is_vindur_cx {
            walk::walk_call_expression(self, call);
            return;
        }
        // Skip calls another pass edits: around them, or inside them, since the replacement
        // copies the call's source
        if self
            .edits
            .iter()
            .any(|edit| edit.span.start < call.span.end && edit.span.end > call.span.start)
        {
            walk::walk_call_expression(self, call);
            return;
        }
        if let Some(value) = optimized_cx_value(&call.arguments, self.source, self.scoping) {
            if !self.inside_spread {
                self.optimized_calls += 1;
            }
            self.edits.push(Edit {
                span: call.span,
                replacement: value.into_replacement(),
            });
        } else if let Some(value) = format_computed_object_call(&call.arguments, self.source) {
            self.edits.push(Edit {
                span: call.span,
                replacement: value,
            });
        }
        walk::walk_call_expression(self, call);
    }
}

#[derive(Debug)]
enum CxToken {
    Conditional {
        condition: String,
        value: Vec<ClassPart>,
    },
    Static(String),
}

// A piece of a conditional class value, `size-${size}` is the text `size-` and the expression
// `size`
#[derive(Debug)]
enum ClassPart {
    Text(String),
    Expression(String),
}

// The expression replacing an optimized `cx(...)` call
enum CxValue {
    Literal(String),
    Expression(String),
}

impl CxValue {
    // Expressions are parenthesized, the call may be an operand, like `cx({ a }) + " b"`
    fn into_replacement(self) -> String {
        match self {
            Self::Literal(value) => value,
            Self::Expression(value) => format!("({value})"),
        }
    }
}

fn optimized_cx_value(
    arguments: &[Argument<'_>],
    source: &str,
    scoping: &Scoping,
) -> Option<CxValue> {
    if let Some(value) = static_cx_value(arguments, scoping) {
        let object_index = arguments
            .iter()
            .position(|argument| matches!(argument, Argument::ObjectExpression(_)));
        if let Some(index) = object_index
            && index > 0
        {
            let prefix = static_cx_value(&arguments[..index], scoping)?;
            let suffix = static_cx_value(&arguments[index..], scoping)?;
            return Some(CxValue::Expression(format!(
                "{} + {}",
                js_string_literal(&prefix),
                js_string_literal(&format!(" {suffix}"))
            )));
        }
        return Some(CxValue::Literal(js_string_literal(&value)));
    }

    if let [
        Argument::StringLiteral(prefix),
        Argument::ObjectExpression(object),
    ] = arguments
    {
        let mut object_tokens = Vec::new();
        collect_object_tokens(object, source, &mut object_tokens)?;
        let rendered = match render_tokens(object_tokens, true) {
            CxValue::Literal(value) | CxValue::Expression(value) => value,
        };
        return Some(CxValue::Expression(format!(
            "{} + ({rendered})",
            js_string_literal(prefix.value.as_str()),
        )));
    }

    let mut tokens = Vec::new();
    for argument in arguments {
        collect_argument_tokens(argument, source, scoping, &mut tokens)?;
    }
    Some(render_tokens(tokens, false))
}

fn render_tokens(tokens: Vec<CxToken>, mut has_prior: bool) -> CxValue {
    let mut parts = Vec::new();
    let mut only_static = true;
    for token in tokens {
        match token {
            CxToken::Static(value) => {
                if value.is_empty() {
                    continue;
                }
                let spaced = if has_prior {
                    format!(" {value}")
                } else {
                    value
                };
                parts.push(js_string_literal(&spaced));
                has_prior = true;
            }
            CxToken::Conditional { condition, value } => {
                let value = if has_prior {
                    add_leading_space(value)
                } else {
                    value
                };
                let value_expression = class_parts_expression(value);
                parts.push(format!("({condition} ? {value_expression} : \"\")"));
                has_prior = true;
                only_static = false;
            }
        }
    }
    match parts.as_slice() {
        [] => CxValue::Literal(js_string_literal("")),
        [single] if only_static => CxValue::Literal(single.clone()),
        [single] => CxValue::Expression(
            single
                .strip_prefix('(')
                .and_then(|inner| inner.strip_suffix(')'))
                .unwrap_or(single)
                .to_owned(),
        ),
        _ => CxValue::Expression(parts.join(" + ")),
    }
}

fn format_computed_object_call(arguments: &[Argument<'_>], source: &str) -> Option<String> {
    let [Argument::ObjectExpression(object)] = arguments else {
        return None;
    };
    if !object.properties.iter().any(|property| {
        matches!(
            property,
            ObjectPropertyKind::ObjectProperty(property) if property.computed
        )
    }) {
        return None;
    }
    let properties = object
        .properties
        .iter()
        .map(|property| {
            let span = property.span();
            source[span.start as usize..span.end as usize].to_owned()
        })
        .collect::<Vec<_>>();
    Some(format!("cx({{\n{},\n}})", properties.join(",\n")))
}

fn collect_argument_tokens(
    argument: &Argument<'_>,
    source: &str,
    scoping: &Scoping,
    tokens: &mut Vec<CxToken>,
) -> Option<()> {
    match argument {
        Argument::StringLiteral(literal) => {
            tokens.push(CxToken::Static(literal.value.to_string()));
        }
        Argument::BooleanLiteral(literal) if !literal.value => {}
        Argument::NullLiteral(_) => {}
        Argument::Identifier(identifier) if is_global_undefined(identifier, scoping) => {}
        Argument::ObjectExpression(object) => collect_object_tokens(object, source, tokens)?,
        Argument::LogicalExpression(logical) if logical.operator == LogicalOperator::And => {
            let value = class_value_parts(&logical.right, source)?;
            tokens.push(CxToken::Conditional {
                condition: condition_source(&logical.left, source),
                value,
            });
        }
        _ => return None,
    }
    Some(())
}

fn collect_object_tokens(
    object: &oxc_ast::ast::ObjectExpression<'_>,
    source: &str,
    tokens: &mut Vec<CxToken>,
) -> Option<()> {
    let mut static_properties = Vec::new();
    let mut dynamic_properties = Vec::new();
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        // Getters, setters, methods and prototype setters are kept as a runtime call
        if property.computed
            || property.kind != PropertyKind::Init
            || property.method
            || is_prototype_setter(property)
        {
            return None;
        }
        let name = property.key.static_name()?.into_owned();
        match &property.value {
            Expression::BooleanLiteral(value) if value.value => {
                static_properties.push(CxToken::Static(name));
            }
            Expression::BooleanLiteral(_) => {}
            expression => {
                dynamic_properties.push(CxToken::Conditional {
                    condition: condition_source(expression, source),
                    value: vec![ClassPart::Text(name)],
                });
            }
        }
    }
    tokens.extend(static_properties);
    tokens.extend(dynamic_properties);
    Some(())
}

// The condition of a generated `condition ? class : ""`
fn condition_source(expression: &Expression<'_>, source: &str) -> String {
    let span = expression.span();
    condition_text(expression, &source[span.start as usize..span.end as usize])
}

/// The `text` of `expression` as the condition of a generated `condition ? class : ""`,
/// parenthesized when its own operator binds looser than `?:` or would nest into it
pub(super) fn condition_text(expression: &Expression<'_>, text: &str) -> String {
    if matches!(
        expression,
        Expression::ConditionalExpression(_)
            | Expression::AssignmentExpression(_)
            | Expression::SequenceExpression(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::YieldExpression(_)
    ) {
        format!("({text})")
    } else {
        text.to_owned()
    }
}

// The class of a `condition && class` argument, read from the AST so template expressions keep
// their own grouping, like `${mode ? "lg" : "sm"}`
fn class_value_parts(expression: &Expression<'_>, source: &str) -> Option<Vec<ClassPart>> {
    match expression {
        Expression::StringLiteral(literal) => {
            Some(vec![ClassPart::Text(literal.value.to_string())])
        }
        Expression::TemplateLiteral(template) => {
            let mut parts = Vec::new();
            for (index, quasi) in template.quasis.iter().enumerate() {
                parts.push(ClassPart::Text(quasi.value.cooked?.to_string()));
                if let Some(expression) = template.expressions.get(index) {
                    let span = expression.span();
                    parts.push(ClassPart::Expression(
                        source[span.start as usize..span.end as usize].to_owned(),
                    ));
                }
            }
            Some(parts)
        }
        _ => None,
    }
}

fn add_leading_space(mut parts: Vec<ClassPart>) -> Vec<ClassPart> {
    match parts.first_mut() {
        Some(ClassPart::Text(text)) => text.insert(0, ' '),
        _ => parts.insert(0, ClassPart::Text(" ".to_owned())),
    }
    parts
}

// A class value with expressions stays a template literal, so `${value}` converts with the
// "string" hint like the runtime call, unlike `+`
fn class_parts_expression(parts: Vec<ClassPart>) -> String {
    if !parts
        .iter()
        .any(|part| matches!(part, ClassPart::Expression(_)))
    {
        let text = parts
            .into_iter()
            .map(|part| match part {
                ClassPart::Text(text) | ClassPart::Expression(text) => text,
            })
            .collect::<String>();
        return js_string_literal(&text);
    }
    let mut template = String::from("`");
    for part in parts {
        match part {
            ClassPart::Text(text) => template.push_str(&template_text(&text)),
            ClassPart::Expression(expression) => {
                template.push_str("${");
                template.push_str(&expression);
                template.push('}');
            }
        }
    }
    template.push('`');
    template
}

// `text` escaped for a template literal
fn template_text(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '`' => escaped.push_str("\\`"),
            '\r' => escaped.push_str("\\r"),
            '$' if characters.peek() == Some(&'{') => escaped.push_str("\\$"),
            _ => escaped.push(character),
        }
    }
    escaped
}

// `undefined` that isn't shadowed by a local binding
fn is_global_undefined(identifier: &IdentifierReference<'_>, scoping: &Scoping) -> bool {
    identifier.name.as_str() == "undefined"
        && scoping
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
}

// `{ __proto__: value }` sets the prototype instead of adding a key
fn is_prototype_setter(property: &ObjectProperty<'_>) -> bool {
    !property.shorthand
        && property
            .key
            .static_name()
            .is_some_and(|name| name == "__proto__")
}

fn static_cx_value(arguments: &[Argument<'_>], scoping: &Scoping) -> Option<String> {
    let mut classes = Vec::new();
    for argument in arguments {
        match argument {
            Argument::StringLiteral(literal) => {
                if !literal.value.is_empty() {
                    classes.push(literal.value.to_string());
                }
            }
            Argument::BooleanLiteral(literal) if !literal.value => {}
            Argument::NullLiteral(_) => {}
            Argument::Identifier(identifier) if is_global_undefined(identifier, scoping) => {}
            Argument::ObjectExpression(object) => {
                for property in &object.properties {
                    let ObjectPropertyKind::ObjectProperty(property) = property else {
                        return None;
                    };
                    if property.computed || is_prototype_setter(property) {
                        return None;
                    }
                    let Expression::BooleanLiteral(value) = &property.value else {
                        return None;
                    };
                    if value.value {
                        classes.push(property.key.static_name()?.into_owned());
                    }
                }
            }
            _ => return None,
        }
    }
    Some(classes.join(" "))
}

fn remove_cx_import(program: &Program<'_>, source: &str, edits: &mut Vec<Edit>) {
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.source.value.as_str() != "vindur" {
            continue;
        }
        let Some(specifiers) = &declaration.specifiers else {
            continue;
        };
        let has_cx = specifiers.iter().any(|specifier| {
            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                return false;
            };
            specifier.imported.name().as_str() == "cx"
        });
        if !has_cx {
            continue;
        }
        let remaining = specifiers
            .iter()
            .filter_map(|specifier| {
                if let ImportDeclarationSpecifier::ImportSpecifier(named) = specifier {
                    let imported_name = named.imported.name();
                    if imported_name.as_str() == "cx"
                        || is_compile_time_import(imported_name.as_str())
                    {
                        return None;
                    }
                }
                let span = specifier.span();
                Some(source[span.start as usize..span.end as usize].to_owned())
            })
            .collect::<Vec<_>>();
        let span = if remaining.is_empty() {
            expand_removal_to_line(source, declaration.span)
        } else {
            declaration.span
        };
        let replacement = if remaining.is_empty() {
            String::new()
        } else {
            format!("import {{ {} }} from \"vindur\";", remaining.join(", "))
        };
        if let Some(existing) = edits.iter_mut().find(|edit| edit.span == declaration.span) {
            existing.span = span;
            existing.replacement = replacement;
        } else {
            edits.push(Edit { span, replacement });
        }
    }
}
