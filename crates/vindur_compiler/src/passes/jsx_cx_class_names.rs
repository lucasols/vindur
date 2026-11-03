use oxc_ast::ast::{
    Argument, BindingPattern, Expression, JSXAttributeValue, JSXElement, JSXExpression,
    LogicalOperator, ObjectPropertyKind, Program, VariableDeclarator,
};
use std::borrow::Cow;

use oxc_ast_visit::{Visit, walk};
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, semantic::VindurImports};

use super::{
    jsx_attributes::{find_attributes, jsx_name},
    jsx_cx_component_references::HashedStyledModifier,
    styled::StyledComponent,
    styled_jsx_helpers::decode_jsx_entities,
};

/// Fails for a class written as a string in the `className` of an element whose cx prop hashes
/// it, e.g. `<Box className="active" />` with `<Box cx={{ active }} />` or
/// `<div css={...} cx={{ active }} className="active" />`, as its `&.active` styles are renamed to
/// the hashed class. Also checks the `className` of the styled component `.attrs()`
pub(crate) fn static_hashed_class_name_error(
    program: &Program<'_>,
    context: StaticClassNameContext<'_>,
) -> Option<CompilerDiagnostic> {
    if !context.has_hashed_keys {
        return None;
    }
    let mut visitor = StaticClassNameVisitor {
        context,
        diagnostic: None,
    };
    visitor.visit_program(program);
    visitor.diagnostic
}

pub(crate) struct StaticClassNameContext<'a> {
    pub imports: &'a VindurImports<'a>,
    pub styled_components: &'a FxHashMap<String, StyledComponent>,
    pub modifiers: &'a [HashedStyledModifier],
    pub has_hashed_keys: bool,
    pub file_path: &'a str,
    pub source: &'a str,
}

struct StaticClassNameVisitor<'a> {
    context: StaticClassNameContext<'a>,
    diagnostic: Option<CompilerDiagnostic>,
}

/// A hashed cx key and the element whose cx prop hashes it
struct HashedKey {
    name: String,
    owner: String,
}

impl<'a> Visit<'a> for StaticClassNameVisitor<'_> {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        self.check_element(element);
        walk::walk_jsx_element(self, element);
    }

    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        self.check_attrs(declarator);
        walk::walk_variable_declarator(self, declarator);
    }
}

impl StaticClassNameVisitor<'_> {
    fn check_element(&mut self, element: &JSXElement<'_>) {
        let Some(name) = jsx_name(&element.opening_element.name) else {
            return;
        };
        let mut hashed = match self.context.styled_components.get(name) {
            Some(styled) => self.styled_hashed_keys(styled),
            None => Vec::new(),
        };
        hashed.extend(own_hashed_keys(element).map(|key| HashedKey {
            name: key,
            owner: name.to_owned(),
        }));
        if hashed.is_empty() {
            return;
        }
        let mut strings = Vec::new();
        for attribute in find_attributes(element, "className") {
            match &attribute.value {
                Some(JSXAttributeValue::StringLiteral(literal)) => {
                    strings.push((decode_jsx_entities(&literal.value), literal.span));
                }
                Some(JSXAttributeValue::ExpressionContainer(container)) => {
                    if let Some(expression) = container.expression.as_expression() {
                        self.class_strings(expression, false, &mut strings);
                    }
                }
                _ => {}
            }
        }
        self.report(name, &hashed, &strings);
    }

    /// The `className` of `styled.div.attrs({ className: '...' })`
    fn check_attrs(&mut self, declarator: &VariableDeclarator<'_>) {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            return;
        };
        let name = identifier.name.as_str();
        let Some(styled) = self.context.styled_components.get(name) else {
            return;
        };
        let Some(Expression::TaggedTemplateExpression(tagged)) = &declarator.init else {
            return;
        };
        let Expression::CallExpression(call) = &tagged.tag else {
            return;
        };
        let Expression::StaticMemberExpression(member) = &call.callee else {
            return;
        };
        let [Argument::ObjectExpression(object)] = call.arguments.as_slice() else {
            return;
        };
        if member.property.name.as_str() != "attrs" {
            return;
        }
        let hashed = self.styled_hashed_keys(styled);
        if hashed.is_empty() {
            return;
        }
        let mut strings = Vec::new();
        for property in &object.properties {
            if let ObjectPropertyKind::ObjectProperty(property) = property
                && property.key.static_name().as_deref() == Some("className")
            {
                self.class_strings(&property.value, false, &mut strings);
            }
        }
        self.report(name, &hashed, &strings);
    }

    /// The hashed keys of the cx props of a styled component, also of the components it extends
    fn styled_hashed_keys(&self, styled: &StyledComponent) -> Vec<HashedKey> {
        self.context
            .modifiers
            .iter()
            .filter(|modifier| {
                modifier.classes.last().is_some_and(|owner| {
                    styled
                        .class_name
                        .split_whitespace()
                        .any(|class| class == owner)
                })
            })
            .map(|modifier| HashedKey {
                name: modifier.class_name.clone(),
                owner: modifier.element_name.clone(),
            })
            .collect()
    }

    fn report(&mut self, name: &str, hashed: &[HashedKey], strings: &[(String, Span)]) {
        for (classes, span) in strings {
            for class in classes.split_ascii_whitespace() {
                let Some(key) = hashed.iter().find(|key| key.name == class) else {
                    continue;
                };
                self.diagnostic = Some(CompilerDiagnostic::error(
                    self.context.file_path,
                    self.context.source,
                    *span,
                    format!(
                        "class \"{class}\" on \"{name}\" never matches its \"&.{class}\" styles, as the cx prop of \"{owner}\" hashes it. Use cx={{{{ {class}: true }}}} instead, or \"${class}\" in the cx prop to keep the class name",
                        owner = key.owner
                    ),
                ));
                return;
            }
        }
    }

    /// The string literals of a className expression that become classes, e.g. both branches of a
    /// conditional or the arguments and object keys of a `cx()` call. `in_cx` is set for the
    /// arguments of a `cx()` call, where object keys are classes
    fn class_strings(
        &self,
        expression: &Expression<'_>,
        in_cx: bool,
        strings: &mut Vec<(String, Span)>,
    ) {
        match expression.get_inner_expression() {
            Expression::StringLiteral(literal) => {
                strings.push((literal.value.as_str().to_owned(), literal.span));
            }
            Expression::TemplateLiteral(template) => {
                let last = template.quasis.len().saturating_sub(1);
                for (index, quasi) in template.quasis.iter().enumerate() {
                    let Some(cooked) = &quasi.value.cooked else {
                        continue;
                    };
                    let text = cooked.as_str();
                    // Classes joined to an expression, like `item-` in `item-${id}`, are not
                    // known
                    let start = if index > 0 && !text.starts_with(|c: char| c.is_ascii_whitespace())
                    {
                        text.find(|c: char| c.is_ascii_whitespace())
                            .unwrap_or(text.len())
                    } else {
                        0
                    };
                    let end = if index < last && !text.ends_with(|c: char| c.is_ascii_whitespace())
                    {
                        text.rfind(|c: char| c.is_ascii_whitespace()).unwrap_or(0)
                    } else {
                        text.len()
                    };
                    if start < end {
                        strings.push((text[start..end].to_owned(), quasi.span));
                    }
                }
            }
            Expression::ConditionalExpression(conditional) => {
                self.class_strings(&conditional.consequent, in_cx, strings);
                self.class_strings(&conditional.alternate, in_cx, strings);
            }
            Expression::LogicalExpression(logical) => {
                if logical.operator != LogicalOperator::And {
                    self.class_strings(&logical.left, in_cx, strings);
                }
                self.class_strings(&logical.right, in_cx, strings);
            }
            Expression::ObjectExpression(object) if in_cx => {
                for property in &object.properties {
                    if let ObjectPropertyKind::ObjectProperty(property) = property
                        && !is_falsy_literal(&property.value)
                        && let Some(key) = property.key.static_name()
                    {
                        strings.push((key.into_owned(), property.key.span()));
                    }
                }
            }
            Expression::CallExpression(call)
                if self.context.imports.get_expression(&call.callee) == Some("cx") =>
            {
                for argument in &call.arguments {
                    if let Some(expression) = argument.as_expression() {
                        self.class_strings(expression, true, strings);
                    }
                }
            }
            _ => {}
        }
    }
}

/// The keys an element's own cx prop hashes, e.g. `active` in `<div css={...} cx={{ active }} />`
fn own_hashed_keys(element: &JSXElement<'_>) -> impl Iterator<Item = String> {
    let object = find_attributes(element, "cx").find_map(|attribute| match &attribute.value {
        Some(JSXAttributeValue::ExpressionContainer(container)) => match &container.expression {
            JSXExpression::ObjectExpression(object) => Some(object),
            _ => None,
        },
        _ => None,
    });
    object
        .into_iter()
        .flat_map(|object| &object.properties)
        .filter_map(|property| match property {
            ObjectPropertyKind::ObjectProperty(property) if !property.computed => {
                property.key.static_name().map(Cow::into_owned)
            }
            _ => None,
        })
        .filter(|key| !key.starts_with('$'))
}

/// `false`, `null`, `undefined`, `0` and `''`, which `cx()` skips
fn is_falsy_literal(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => !literal.value,
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        Expression::NumericLiteral(literal) => literal.value == 0.0,
        Expression::StringLiteral(literal) => literal.value.is_empty(),
        _ => false,
    }
}
