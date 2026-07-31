use oxc_ast::ast::{
    Argument, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
    JSXElement, JSXElementName, JSXExpression, Program,
};
use oxc_ast_visit::{Visit, walk};
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, edit::Edit, facts::StaticValue};

use super::styled::StyledComponent;

pub(super) struct DynamicColorTransform<'a> {
    pub constants: &'a FxHashMap<String, StaticValue>,
    pub imported_values: &'a FxHashMap<String, StaticValue>,
    pub edits: &'a mut Vec<Edit>,
    pub file_path: &'a str,
    pub source: &'a str,
    pub styled_components: &'a FxHashMap<String, StyledComponent>,
    pub needs_merge_class_names: &'a mut bool,
    pub needs_merge_styles: &'a mut bool,
}

pub(super) fn transform_dynamic_color_props(
    program: &Program<'_>,
    output: DynamicColorTransform<'_>,
) -> Result<(), CompilerDiagnostic> {
    let mut visitor = DynamicColorVisitor {
        output,
        diagnostic: None,
    };
    visitor.visit_program(program);
    visitor.diagnostic.map_or(Ok(()), Err)
}

struct DynamicColorVisitor<'a> {
    output: DynamicColorTransform<'a>,
    diagnostic: Option<CompilerDiagnostic>,
}

impl<'a> Visit<'a> for DynamicColorVisitor<'_> {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        if let Some(attribute) = find_attribute(element, "dynamicColor") {
            self.transform_attribute(element, attribute);
        }
        if self.diagnostic.is_none() {
            walk::walk_jsx_element(self, element);
        }
    }
}

impl DynamicColorVisitor<'_> {
    fn transform_attribute(&mut self, element: &JSXElement<'_>, attribute: &JSXAttribute<'_>) {
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            self.error(
                attribute.span,
                "dynamicColor prop must be an expression".to_owned(),
            );
            return;
        };
        let Some(colors) = self.color_expressions(&container.expression) else {
            if let Some(message) = self.conditional_error_message(&container.expression) {
                self.error(container.expression.span(), message);
                return;
            }
            self.error(
                container.expression.span(),
                "dynamicColor prop must reference a dynamic color or color.set(...)".to_owned(),
            );
            return;
        };
        let component = jsx_name(&element.opening_element.name)
            .and_then(|name| self.output.styled_components.get(name));
        if let Some(component) = component
            && !component.runtime
        {
            self.output.edits.push(Edit {
                span: element.opening_element.name.span(),
                replacement: component.element.clone(),
            });
            if let Some(closing) = &element.closing_element {
                self.output.edits.push(Edit {
                    span: closing.name.span(),
                    replacement: component.element.clone(),
                });
            }
        }

        let class_attribute = find_last_attribute(element, "className");
        let style_attribute = find_last_attribute(element, "style");
        let spreads = spread_sources(element, self.output.source);
        let preserve_native_attributes = component.is_none()
            && spreads.is_empty()
            && colors.iter().all(|color| {
                matches!(
                    self.output.imported_values.get(&color.name),
                    Some(StaticValue::DynamicColor { .. })
                )
            });
        if !preserve_native_attributes {
            for item in &element.opening_element.attributes {
                let JSXAttributeItem::Attribute(other) = item else {
                    continue;
                };
                let JSXAttributeName::Identifier(name) = &other.name else {
                    continue;
                };
                if matches!(name.name.as_str(), "className" | "style") {
                    self.output.edits.push(Edit {
                        span: other.span,
                        replacement: String::new(),
                    });
                }
            }
        }

        let base_class = component.map(|component| component.class_name.as_str());
        let merge = if preserve_native_attributes
            && (class_attribute.is_some() || style_attribute.is_some())
        {
            Some("{}".to_owned())
        } else {
            color_merge_object(
                base_class,
                class_attribute,
                style_attribute,
                &spreads,
                self.output.source,
                self.output.needs_merge_class_names,
                self.output.needs_merge_styles,
            )
        };
        let call = colors.iter().rev().fold(merge, |inner, color| {
            let suffix = inner.map_or(String::new(), |value| format!(", {value}"));
            Some(format!("{}._sp({}{suffix})", color.name, color.value))
        });
        let Some(call) = call else {
            return;
        };
        if spreads.is_empty() {
            self.output.edits.push(Edit {
                span: attribute.span,
                replacement: String::new(),
            });
            let offset = opening_attribute_insertion_offset(element, self.output.source);
            self.output.edits.push(Edit {
                span: oxc_span::Span::new(offset, offset),
                replacement: format!(" {{...{call}}}"),
            });
        } else {
            let mut trailing_props = Vec::new();
            for item in &element.opening_element.attributes {
                let JSXAttributeItem::Attribute(other) = item else {
                    continue;
                };
                if other.span.start <= attribute.span.start {
                    continue;
                }
                let JSXAttributeName::Identifier(name) = &other.name else {
                    continue;
                };
                if name.name.as_str().starts_with("on")
                    || matches!(name.name.as_str(), "className" | "style")
                {
                    continue;
                }
                trailing_props.push(
                    self.output.source[other.span.start as usize..other.span.end as usize]
                        .to_owned(),
                );
                self.output.edits.push(Edit {
                    span: other.span,
                    replacement: String::new(),
                });
            }
            let prefix = if trailing_props.is_empty() {
                String::new()
            } else {
                format!("{} ", trailing_props.join(" "))
            };
            self.output.edits.push(Edit {
                span: attribute.span,
                replacement: format!("{prefix}{{...{call}}}"),
            });
        }
    }

    fn conditional_error_message(&self, expression: &JSXExpression<'_>) -> Option<String> {
        let (condition, call, alternate) = match expression {
            JSXExpression::ConditionalExpression(conditional) => (
                expression_source(&conditional.test, self.output.source),
                &conditional.consequent,
                expression_source(&conditional.alternate, self.output.source),
            ),
            JSXExpression::LogicalExpression(logical) => (
                expression_source(&logical.left, self.output.source),
                &logical.right,
                "null".to_owned(),
            ),
            _ => return None,
        };
        let Expression::CallExpression(call) = call else {
            return None;
        };
        let Expression::StaticMemberExpression(callee) = &call.callee else {
            return None;
        };
        if callee.property.name.as_str() != "set" {
            return None;
        }
        let Expression::Identifier(color) = &callee.object else {
            return None;
        };
        let argument = call.arguments.first()?;
        let argument_source = expression_source(argument, self.output.source);
        Some(format!(
            "Conditional dynamicColor is not supported. Use condition inside the set function instead: {}.set({condition} ? {argument_source} : {alternate})",
            color.name
        ))
    }

    fn color_expressions(&self, expression: &JSXExpression<'_>) -> Option<Vec<ColorExpression>> {
        match expression {
            JSXExpression::Identifier(identifier) => {
                self.identifier_color(identifier.name.as_str())
            }
            JSXExpression::CallExpression(call) => self.call_color(call),
            JSXExpression::ArrayExpression(array) => array
                .elements
                .iter()
                .map(|element| {
                    let expression = element.as_expression()?;
                    match expression {
                        Expression::Identifier(identifier) => {
                            self.identifier_color(identifier.name.as_str())
                        }
                        Expression::CallExpression(call) => self.call_color(call),
                        _ => None,
                    }
                })
                .collect::<Option<Vec<_>>>()
                .map(|groups| groups.into_iter().flatten().collect()),
            _ => None,
        }
    }

    fn identifier_color(&self, name: &str) -> Option<Vec<ColorExpression>> {
        matches!(
            self.output.constants.get(name),
            Some(StaticValue::DynamicColor { .. })
        )
        .then(|| {
            vec![ColorExpression {
                name: name.to_owned(),
                value: "\"#ff6b6b\"".to_owned(),
            }]
        })
    }

    fn call_color(&self, call: &oxc_ast::ast::CallExpression<'_>) -> Option<Vec<ColorExpression>> {
        let Expression::StaticMemberExpression(callee) = &call.callee else {
            return None;
        };
        if callee.property.name.as_str() != "set" {
            return None;
        }
        let Expression::Identifier(color) = &callee.object else {
            return None;
        };
        if !matches!(
            self.output.constants.get(color.name.as_str()),
            Some(StaticValue::DynamicColor { .. })
        ) {
            return None;
        }
        let [Argument::StringLiteral(value)] = call.arguments.as_slice() else {
            let [argument] = call.arguments.as_slice() else {
                return None;
            };
            let span = argument.span();
            return Some(vec![ColorExpression {
                name: color.name.to_string(),
                value: self.output.source[span.start as usize..span.end as usize].to_owned(),
            }]);
        };
        Some(vec![ColorExpression {
            name: color.name.to_string(),
            value: format!("\"{}\"", value.value),
        }])
    }

    fn error(&mut self, span: oxc_span::Span, message: String) {
        self.diagnostic = Some(CompilerDiagnostic::error(
            self.output.file_path,
            self.output.source,
            span,
            message,
        ));
    }
}

struct ColorExpression {
    name: String,
    value: String,
}

fn color_merge_object(
    base_class: Option<&str>,
    class_attribute: Option<&JSXAttribute<'_>>,
    style_attribute: Option<&JSXAttribute<'_>>,
    spreads: &[SpreadSource],
    source: &str,
    needs_merge_class_names: &mut bool,
    needs_merge_styles: &mut bool,
) -> Option<String> {
    let last_spread_start = spreads.last().map_or(0, |spread| spread.start);
    let spread_names = spreads
        .iter()
        .map(|spread| spread.source.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let class_after_spreads = class_attribute
        .is_some_and(|attribute| spreads.is_empty() || attribute.span.start > last_spread_start);
    let style_after_spreads = style_attribute
        .is_some_and(|attribute| spreads.is_empty() || attribute.span.start > last_spread_start);
    let class_name = if !spreads.is_empty() && !class_after_spreads {
        *needs_merge_class_names = true;
        Some(format!(
            "mergeClassNames([{}], {})",
            spread_names,
            base_class.map_or("undefined".to_owned(), |base| format!("\"{base}\""))
        ))
    } else {
        match (base_class, class_attribute) {
            (None, None) => None,
            (Some(base), None) => Some(format!("\"{base}\"")),
            (None, Some(attribute)) => Some(attribute_value_source(attribute, source)),
            (Some(base), Some(attribute)) => match &attribute.value {
                Some(JSXAttributeValue::StringLiteral(value)) => {
                    Some(format!("\"{base} {}\"", value.value))
                }
                _ => Some(format!(
                    "[\"{base}\", {}].filter(Boolean).join(\" \")",
                    attribute_value_source(attribute, source)
                )),
            },
        }
    };
    let style = if !spreads.is_empty() && !style_after_spreads {
        *needs_merge_styles = true;
        Some(format!("mergeStyles([{spread_names}])"))
    } else {
        style_attribute.map(|attribute| attribute_value_source(attribute, source))
    };
    if class_name.is_none() && style.is_none() {
        return None;
    }
    let mut properties = Vec::new();
    if let Some(class_name) = class_name {
        properties.push(format!("className: {class_name}"));
    }
    if let Some(style) = style {
        properties.push(format!("style: {style}"));
    }
    Some(format!("{{\n{},\n}}", properties.join(",\n")))
}

fn attribute_value_source(attribute: &JSXAttribute<'_>, source: &str) -> String {
    match &attribute.value {
        Some(JSXAttributeValue::StringLiteral(value)) => format!("\"{}\"", value.value),
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            let span = container.expression.span();
            source[span.start as usize..span.end as usize].to_owned()
        }
        _ => "undefined".to_owned(),
    }
}

fn expression_source(value: &impl GetSpan, source: &str) -> String {
    let span = value.span();
    source[span.start as usize..span.end as usize].to_owned()
}

fn find_attribute<'a>(element: &'a JSXElement<'a>, name: &str) -> Option<&'a JSXAttribute<'a>> {
    element.opening_element.attributes.iter().find_map(|item| {
        let JSXAttributeItem::Attribute(attribute) = item else {
            return None;
        };
        let JSXAttributeName::Identifier(identifier) = &attribute.name else {
            return None;
        };
        (identifier.name.as_str() == name).then_some(&**attribute)
    })
}

fn find_last_attribute<'a>(
    element: &'a JSXElement<'a>,
    name: &str,
) -> Option<&'a JSXAttribute<'a>> {
    element
        .opening_element
        .attributes
        .iter()
        .rev()
        .find_map(|item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return None;
            };
            let JSXAttributeName::Identifier(identifier) = &attribute.name else {
                return None;
            };
            (identifier.name.as_str() == name).then_some(&**attribute)
        })
}

struct SpreadSource {
    source: String,
    start: u32,
}

fn spread_sources(element: &JSXElement<'_>, source: &str) -> Vec<SpreadSource> {
    element
        .opening_element
        .attributes
        .iter()
        .filter_map(|item| {
            let JSXAttributeItem::SpreadAttribute(spread) = item else {
                return None;
            };
            let span = spread.argument.span();
            Some(SpreadSource {
                source: source[span.start as usize..span.end as usize].to_owned(),
                start: spread.span.start,
            })
        })
        .collect()
}

fn jsx_name<'a>(name: &'a JSXElementName<'a>) -> Option<&'a str> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn opening_attribute_insertion_offset(element: &JSXElement<'_>, source: &str) -> u32 {
    let end = element.opening_element.span.end.saturating_sub(1);
    if source.as_bytes().get(end.saturating_sub(1) as usize) == Some(&b'/') {
        end.saturating_sub(1)
    } else {
        end
    }
}
