use oxc_ast::ast::{
    Argument, Expression, JSXAttributeValue, JSXElement, LogicalOperator, ObjectPropertyKind,
    Program,
};
use oxc_ast_visit::{Visit, walk};
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, semantic::VindurImports};

use super::{
    jsx_attributes::{find_attributes, jsx_name},
    jsx_cx_component_references::HashedStyledModifier,
    styled::StyledComponent,
};

/// Fails for a class written as a string in the `className` of a styled component whose cx prop
/// hashes it, e.g. `<Box className="active" />` with `<Box cx={{ active }} />`, as its `&.active`
/// styles are renamed to the hashed class
pub(crate) fn static_hashed_class_name_error(
    program: &Program<'_>,
    context: StaticClassNameContext<'_>,
) -> Option<CompilerDiagnostic> {
    if context.modifiers.is_empty() {
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
    pub file_path: &'a str,
    pub source: &'a str,
}

struct StaticClassNameVisitor<'a> {
    context: StaticClassNameContext<'a>,
    diagnostic: Option<CompilerDiagnostic>,
}

impl<'a> Visit<'a> for StaticClassNameVisitor<'_> {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        self.check_element(element);
        walk::walk_jsx_element(self, element);
    }
}

impl StaticClassNameVisitor<'_> {
    fn check_element(&mut self, element: &JSXElement<'_>) {
        let Some(name) = jsx_name(&element.opening_element.name) else {
            return;
        };
        let Some(styled) = self.context.styled_components.get(name) else {
            return;
        };
        let hashed = self
            .context
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
            .collect::<Vec<_>>();
        if hashed.is_empty() {
            return;
        }
        let mut strings = Vec::new();
        for attribute in find_attributes(element, "className") {
            match &attribute.value {
                Some(JSXAttributeValue::StringLiteral(literal)) => {
                    strings.push((literal.value.as_str().to_owned(), literal.span));
                }
                Some(JSXAttributeValue::ExpressionContainer(container)) => {
                    if let Some(expression) = container.expression.as_expression() {
                        self.class_strings(expression, &mut strings);
                    }
                }
                _ => {}
            }
        }
        for (classes, span) in strings {
            for class in classes.split_whitespace() {
                let Some(modifier) = hashed.iter().find(|modifier| modifier.class_name == class)
                else {
                    continue;
                };
                self.diagnostic = Some(CompilerDiagnostic::error(
                    self.context.file_path,
                    self.context.source,
                    span,
                    format!(
                        "class \"{class}\" on \"{name}\" never matches its \"&.{class}\" styles, as the cx prop of \"{element}\" hashes it. Use cx={{{{ {class}: true }}}} instead, or \"${class}\" in the cx prop to keep the class name",
                        element = modifier.element_name
                    ),
                ));
                return;
            }
        }
    }

    /// The string literals of a className expression that become classes, e.g. both branches of a
    /// conditional or the arguments and object keys of a `cx()` call
    fn class_strings(&self, expression: &Expression<'_>, strings: &mut Vec<(String, Span)>) {
        match expression {
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
                    let start = if index > 0 && !text.starts_with(char::is_whitespace) {
                        text.find(char::is_whitespace).unwrap_or(text.len())
                    } else {
                        0
                    };
                    let end = if index < last && !text.ends_with(char::is_whitespace) {
                        text.rfind(char::is_whitespace).unwrap_or(0)
                    } else {
                        text.len()
                    };
                    if start < end {
                        strings.push((text[start..end].to_owned(), quasi.span));
                    }
                }
            }
            Expression::ParenthesizedExpression(parenthesized) => {
                self.class_strings(&parenthesized.expression, strings);
            }
            Expression::ConditionalExpression(conditional) => {
                self.class_strings(&conditional.consequent, strings);
                self.class_strings(&conditional.alternate, strings);
            }
            Expression::LogicalExpression(logical) => {
                if logical.operator != LogicalOperator::And {
                    self.class_strings(&logical.left, strings);
                }
                self.class_strings(&logical.right, strings);
            }
            Expression::CallExpression(call)
                if self.context.imports.get_expression(&call.callee) == Some("cx") =>
            {
                for argument in &call.arguments {
                    match argument {
                        Argument::ObjectExpression(object) => {
                            for property in &object.properties {
                                if let ObjectPropertyKind::ObjectProperty(property) = property
                                    && !property.computed
                                    && let Some(key) = property.key.static_name()
                                {
                                    strings.push((key.into_owned(), property.key.span()));
                                }
                            }
                        }
                        _ => {
                            if let Some(expression) = argument.as_expression() {
                                self.class_strings(expression, strings);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
}
