use oxc_ast::ast::{
    Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElement,
    JSXElementName,
};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use super::{
    static_evaluation::resolved_constant,
    styled::{StyleFlag, StyleFlagKind},
};

pub(super) fn css_attribute_is_compile_time(
    attribute: &oxc_ast::ast::JSXAttribute<'_>,
    constants: &FxHashMap<String, crate::facts::StaticValue>,
    scoping: &Scoping,
) -> bool {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return true;
    };
    match &container.expression {
        oxc_ast::ast::JSXExpression::Identifier(identifier) => matches!(
            resolved_constant(identifier, constants, scoping),
            Some(crate::facts::StaticValue::CssClass { .. })
        ),
        oxc_ast::ast::JSXExpression::TemplateLiteral(_) => true,
        _ => false,
    }
}

pub(super) struct DynamicFlagClass {
    pub(super) concat: String,
    pub(super) cx: String,
}

pub(super) fn collect_flag_class(
    attribute: &oxc_ast::ast::JSXAttribute<'_>,
    flag: &StyleFlag,
    source: &str,
    static_classes: &mut Vec<String>,
    dynamic_classes: &mut Vec<DynamicFlagClass>,
) {
    match &flag.kind {
        StyleFlagKind::Boolean => match &attribute.value {
            None => static_classes.push(flag.hashed_class_name.clone()),
            Some(JSXAttributeValue::StringLiteral(value)) => {
                if !value.value.is_empty() {
                    static_classes.push(flag.hashed_class_name.clone());
                }
            }
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                match &container.expression {
                    oxc_ast::ast::JSXExpression::BooleanLiteral(value) => {
                        if value.value {
                            static_classes.push(flag.hashed_class_name.clone());
                        }
                    }
                    expression => {
                        let span = expression.span();
                        let expression_source = &source[span.start as usize..span.end as usize];
                        dynamic_classes.push(DynamicFlagClass {
                            concat: format!(
                                " + (({expression_source}) ? \" {}\" : \"\")",
                                flag.hashed_class_name
                            ),
                            cx: format!("({expression_source}) && \"{}\"", flag.hashed_class_name),
                        });
                    }
                }
            }
            _ => {}
        },
        StyleFlagKind::StringUnion(_) => match &attribute.value {
            Some(JSXAttributeValue::StringLiteral(value)) => {
                static_classes.push(format!("{}-{}", flag.hashed_class_name, value.value))
            }
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                match &container.expression {
                    oxc_ast::ast::JSXExpression::StringLiteral(value) => {
                        static_classes.push(format!("{}-{}", flag.hashed_class_name, value.value))
                    }
                    expression => {
                        let span = expression.span();
                        let expression_source = &source[span.start as usize..span.end as usize];
                        dynamic_classes.push(DynamicFlagClass {
                            concat: format!(
                                " + (({expression_source}) ? \" {}-\" + ({expression_source}) : \"\")",
                                flag.hashed_class_name
                            ),
                            cx: format!(
                                "({expression_source}) && `{}-${{({expression_source})}}`",
                                flag.hashed_class_name
                            ),
                        });
                    }
                }
            }
            _ => {}
        },
    }
}

pub(super) fn class_name_expression(
    attribute: &oxc_ast::ast::JSXAttribute<'_>,
    styled_class_name: &str,
    static_classes: &[String],
    source: &str,
) -> String {
    let static_suffix = static_classes
        .iter()
        .map(|class| format!(" {class}"))
        .collect::<String>();
    match &attribute.value {
        Some(JSXAttributeValue::StringLiteral(value)) => {
            format!("\"{styled_class_name} {}{static_suffix}\"", value.value)
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            let span = container.expression.span();
            let expression = &source[span.start as usize..span.end as usize];
            format!(
                "[\"{styled_class_name}\", {expression}, \"{}\"].filter(Boolean).join(\" \")",
                static_classes.join(" ")
            )
        }
        _ => format!("\"{styled_class_name}{static_suffix}\""),
    }
}

pub(super) fn jsx_spread_sources(element: &JSXElement<'_>, source: &str) -> Vec<String> {
    element
        .opening_element
        .attributes
        .iter()
        .filter_map(|item| {
            let JSXAttributeItem::SpreadAttribute(spread) = item else {
                return None;
            };
            let span = spread.argument.span();
            Some(source[span.start as usize..span.end as usize].to_owned())
        })
        .collect()
}

pub(super) struct StyledSpread {
    pub(super) start: u32,
}

pub(super) struct InvalidStyledSpread {
    pub(super) span: oxc_span::Span,
    pub(super) source: String,
}

pub(super) fn styled_spread_sources(
    element: &JSXElement<'_>,
    source: &str,
) -> Result<Vec<StyledSpread>, InvalidStyledSpread> {
    element
        .opening_element
        .attributes
        .iter()
        .filter_map(|item| {
            let JSXAttributeItem::SpreadAttribute(spread) = item else {
                return None;
            };
            let span = spread.argument.span();
            if matches!(&spread.argument, Expression::Identifier(_)) {
                Some(Ok(StyledSpread { start: span.start }))
            } else {
                Some(Err(InvalidStyledSpread {
                    span: spread.span,
                    source: source[span.start as usize..span.end as usize].to_owned(),
                }))
            }
        })
        .collect()
}

pub(super) fn class_name_attributes<'a>(element: &'a JSXElement<'a>) -> Vec<&'a JSXAttribute<'a>> {
    element
        .opening_element
        .attributes
        .iter()
        .filter_map(|item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return None;
            };
            is_named_attribute(attribute, "className").then_some(&**attribute)
        })
        .collect()
}

pub(super) fn is_named_attribute(attribute: &JSXAttribute<'_>, expected: &str) -> bool {
    let JSXAttributeName::Identifier(name) = &attribute.name else {
        return false;
    };
    name.name.as_str() == expected
}

pub(super) fn format_spread_expression(source: &str) -> String {
    let source = source
        .trim()
        .strip_prefix('(')
        .and_then(|value| value.strip_suffix(')'))
        .unwrap_or(source.trim());
    source.replace("{ ", "{\n  ").replace(" }", "\n}")
}

pub(super) fn jsx_name<'a>(name: &'a JSXElementName<'a>) -> Option<&'a str> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

pub(super) fn class_name_value_source(
    attribute: &oxc_ast::ast::JSXAttribute<'_>,
    source: &str,
) -> String {
    let Some(value) = &attribute.value else {
        return "true".to_owned();
    };
    match value {
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            oxc_ast::ast::JSXExpression::EmptyExpression(_) => "undefined".to_owned(),
            expression => {
                let span = expression.span();
                source[span.start as usize..span.end as usize].to_owned()
            }
        },
        JSXAttributeValue::StringLiteral(value) => format!("\"{}\"", value.value),
        _ => "undefined".to_owned(),
    }
}

pub(super) fn opening_attribute_insertion_offset(element: &JSXElement<'_>, source: &str) -> u32 {
    let end = element.opening_element.span.end.saturating_sub(1);
    if source.as_bytes().get(end.saturating_sub(1) as usize) == Some(&b'/') {
        end.saturating_sub(1)
    } else {
        end
    }
}
