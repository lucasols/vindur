use oxc_ast::ast::{
    Argument, Expression, ImportDeclarationSpecifier, ObjectPropertyKind, Program, Statement,
};
use oxc_ast_visit::{Visit, walk};
use oxc_span::GetSpan;
use oxc_syntax::operator::LogicalOperator;

use crate::edit::{Edit, expand_removal_to_line};

use super::import_analysis::is_compile_time_import;

pub(crate) fn optimize_cx_calls(program: &Program<'_>, source: &str, edits: &mut Vec<Edit>) {
    let mut visitor = CxCallVisitor {
        source,
        edits,
        found_calls: 0,
        optimized_calls: 0,
    };
    visitor.visit_program(program);
    if visitor.found_calls > 0 && visitor.found_calls == visitor.optimized_calls {
        remove_cx_import(program, source, visitor.edits);
    }
}

struct CxCallVisitor<'a> {
    source: &'a str,
    edits: &'a mut Vec<Edit>,
    found_calls: usize,
    optimized_calls: usize,
}

impl<'a> Visit<'a> for CxCallVisitor<'_> {
    fn visit_call_expression(&mut self, call: &oxc_ast::ast::CallExpression<'a>) {
        let Expression::Identifier(callee) = &call.callee else {
            walk::walk_call_expression(self, call);
            return;
        };
        if callee.name.as_str() != "cx" {
            walk::walk_call_expression(self, call);
            return;
        }
        self.found_calls += 1;
        if self.edits.iter().any(|edit| {
            edit.span.start <= call.span.start
                && edit.span.end >= call.span.end
                && edit.span.start < edit.span.end
        }) {
            walk::walk_call_expression(self, call);
            return;
        }
        if let Some(value) = optimized_cx_value(&call.arguments, self.source) {
            self.optimized_calls += 1;
            self.edits.push(Edit {
                span: call.span,
                replacement: value,
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
    Conditional { condition: String, value: String },
    Static(String),
}

fn optimized_cx_value(arguments: &[Argument<'_>], source: &str) -> Option<String> {
    if let Some(value) = static_cx_value(arguments) {
        let object_index = arguments
            .iter()
            .position(|argument| matches!(argument, Argument::ObjectExpression(_)));
        if let Some(index) = object_index
            && index > 0
        {
            let prefix = static_cx_value(&arguments[..index])?;
            let suffix = static_cx_value(&arguments[index..])?;
            return Some(format!(
                "{} + {}",
                quoted(&prefix),
                quoted(&format!(" {suffix}"))
            ));
        }
        return Some(quoted(&value));
    }

    if let [
        Argument::StringLiteral(prefix),
        Argument::ObjectExpression(object),
    ] = arguments
    {
        let mut object_tokens = Vec::new();
        collect_object_tokens(object, source, &mut object_tokens)?;
        return Some(format!(
            "{} + ({})",
            quoted(prefix.value.as_str()),
            render_tokens(object_tokens, true)?
        ));
    }

    let mut tokens = Vec::new();
    for argument in arguments {
        collect_argument_tokens(argument, source, &mut tokens)?;
    }
    render_tokens(tokens, false)
}

fn render_tokens(tokens: Vec<CxToken>, mut has_prior: bool) -> Option<String> {
    let mut parts = Vec::new();
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
                parts.push(quoted(&spaced));
                has_prior = true;
            }
            CxToken::Conditional { condition, value } => {
                let value = if has_prior {
                    add_leading_space(value)
                } else {
                    value
                };
                let value_expression = dynamic_class_expression(&value)?;
                parts.push(format!("({condition} ? {value_expression} : \"\")"));
                has_prior = true;
            }
        }
    }
    match parts.as_slice() {
        [] => Some(quoted("")),
        [single] => Some(single.trim_matches(['(', ')']).to_owned()),
        _ => Some(parts.join(" + ")),
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
    tokens: &mut Vec<CxToken>,
) -> Option<()> {
    match argument {
        Argument::StringLiteral(literal) => {
            tokens.push(CxToken::Static(literal.value.to_string()));
        }
        Argument::BooleanLiteral(literal) if !literal.value => {}
        Argument::NullLiteral(_) => {}
        Argument::Identifier(identifier) if identifier.name.as_str() == "undefined" => {}
        Argument::ObjectExpression(object) => collect_object_tokens(object, source, tokens)?,
        Argument::LogicalExpression(logical) if logical.operator == LogicalOperator::And => {
            let value = class_value_source(&logical.right, source)?;
            let span = logical.left.span();
            tokens.push(CxToken::Conditional {
                condition: source[span.start as usize..span.end as usize].to_owned(),
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
        if property.computed {
            return None;
        }
        let name = property.key.static_name()?.into_owned();
        match &property.value {
            Expression::BooleanLiteral(value) if value.value => {
                static_properties.push(CxToken::Static(name));
            }
            Expression::BooleanLiteral(_) => {}
            expression => {
                let span = expression.span();
                dynamic_properties.push(CxToken::Conditional {
                    condition: source[span.start as usize..span.end as usize].to_owned(),
                    value: name,
                });
            }
        }
    }
    tokens.extend(static_properties);
    tokens.extend(dynamic_properties);
    Some(())
}

fn class_value_source(expression: &Expression<'_>, source: &str) -> Option<String> {
    match expression {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template) => {
            let span = template.span;
            Some(source[span.start as usize..span.end as usize].to_owned())
        }
        _ => None,
    }
}

fn add_leading_space(value: String) -> String {
    value
        .strip_prefix('`')
        .map_or_else(|| format!(" {value}"), |template| format!("` {template}"))
}

fn dynamic_class_expression(value: &str) -> Option<String> {
    let Some(template_source) = value.strip_prefix('`') else {
        return Some(quoted(value));
    };
    let template_source = template_source.strip_suffix('`')?;
    let mut parts = Vec::new();
    let mut cursor = 0usize;
    while let Some(relative_start) = template_source[cursor..].find("${") {
        let start = cursor + relative_start;
        if start > cursor {
            parts.push(quoted(&template_source[cursor..start]));
        }
        let expression_start = start + 2;
        let relative_end = template_source[expression_start..].find('}')?;
        let end = expression_start + relative_end;
        parts.push(template_source[expression_start..end].to_owned());
        cursor = end + 1;
    }
    if cursor < template_source.len() {
        parts.push(quoted(&template_source[cursor..]));
    }
    if parts.is_empty() {
        return Some(quoted(template_source));
    }
    Some(parts.join(" + "))
}

fn static_cx_value(arguments: &[Argument<'_>]) -> Option<String> {
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
            Argument::Identifier(identifier) if identifier.name.as_str() == "undefined" => {}
            Argument::ObjectExpression(object) => {
                for property in &object.properties {
                    let ObjectPropertyKind::ObjectProperty(property) = property else {
                        return None;
                    };
                    if property.computed {
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

fn quoted(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}
