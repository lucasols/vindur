use oxc_ast::ast::{
    Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElement,
    JSXElementName,
};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::edit::Edit;

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
    constants: &FxHashMap<String, crate::facts::StaticValue>,
    scoping: &Scoping,
) -> String {
    let static_suffix = static_classes
        .iter()
        .map(|class| format!(" {class}"))
        .collect::<String>();
    match &attribute.value {
        Some(JSXAttributeValue::StringLiteral(value)) => js_string_literal(&format!(
            "{styled_class_name} {}{static_suffix}",
            decode_jsx_entities(&value.value)
        )),
        Some(JSXAttributeValue::ExpressionContainer(_)) => {
            let existing = class_name_concat_source(attribute, source, constants, scoping);
            if static_suffix.is_empty() {
                format!("\"{styled_class_name} \" + {existing}")
            } else {
                format!("\"{styled_class_name} \" + {existing} + \"{static_suffix}\"")
            }
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

pub(super) fn has_spread_attribute(element: &JSXElement<'_>) -> bool {
    element
        .opening_element
        .attributes
        .iter()
        .any(|item| matches!(item, JSXAttributeItem::SpreadAttribute(_)))
}

pub(super) fn has_dynamic_color_attribute(element: &JSXElement<'_>) -> bool {
    element.opening_element.attributes.iter().any(|item| {
        matches!(item, JSXAttributeItem::Attribute(attribute) if is_named_attribute(attribute, "dynamicColor"))
    })
}

pub(super) enum ClassNameTarget {
    /// Replace an existing attribute with the merged className
    Replace(oxc_span::Span),
    /// Insert the merged className at an offset of the opening element
    Insert(u32),
}

/// Emits the merged className expression of an element. Elements with a `dynamicColor` prop
/// hand it to the dynamic color pass instead, which merges it into the `_sp` call
pub(super) fn emit_class_name(
    edits: &mut Vec<Edit>,
    class_expressions: &mut FxHashMap<u32, String>,
    element: &JSXElement<'_>,
    target: ClassNameTarget,
    expression: String,
) {
    if has_dynamic_color_attribute(element) {
        if let ClassNameTarget::Replace(span) = target {
            edits.push(Edit {
                span,
                replacement: String::new(),
            });
        }
        class_expressions.insert(element.span.start, expression);
        return;
    }
    edits.push(match target {
        ClassNameTarget::Replace(span) => Edit {
            span,
            replacement: format!("className={{{expression}}}"),
        },
        ClassNameTarget::Insert(offset) => Edit {
            span: oxc_span::Span::new(offset, offset),
            replacement: format!(" className={{{expression}}}"),
        },
    });
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

pub(super) fn unsupported_spread_message(spread: &InvalidStyledSpread, used_in: &str) -> String {
    format!(
        "Unsupported spread expression \"{}\" used in {used_in}. Only references to variables are allowed in spread expressions. Extract them to a variable and use that variable in the spread expression.",
        format_spread_expression(&spread.source)
    )
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
        return "undefined".to_owned();
    };
    match value {
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            oxc_ast::ast::JSXExpression::EmptyExpression(_) => "undefined".to_owned(),
            expression => {
                let span = expression.span();
                source[span.start as usize..span.end as usize].to_owned()
            }
        },
        JSXAttributeValue::StringLiteral(value) => {
            js_string_literal(&decode_jsx_entities(&value.value))
        }
        _ => "undefined".to_owned(),
    }
}

/// Returns the existing className expression to be concatenated with vindur class names,
/// guarding values that can be falsy at runtime, e.g. an optional `className` prop
pub(super) fn class_name_concat_source(
    attribute: &JSXAttribute<'_>,
    source: &str,
    constants: &FxHashMap<String, crate::facts::StaticValue>,
    scoping: &Scoping,
) -> String {
    let value_source = class_name_value_source(attribute, source);
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return match &attribute.value {
            Some(JSXAttributeValue::StringLiteral(_)) => value_source,
            _ => "\"\"".to_owned(),
        };
    };
    match &container.expression {
        oxc_ast::ast::JSXExpression::Identifier(identifier)
            if matches!(
                resolved_constant(identifier, constants, scoping),
                Some(
                    crate::facts::StaticValue::CssClass { .. }
                        | crate::facts::StaticValue::String(_)
                )
            ) =>
        {
            value_source
        }
        // Operands that bind tighter than `||` don't need to be parenthesized
        oxc_ast::ast::JSXExpression::Identifier(_)
        | oxc_ast::ast::JSXExpression::StaticMemberExpression(_)
        | oxc_ast::ast::JSXExpression::ComputedMemberExpression(_)
        | oxc_ast::ast::JSXExpression::CallExpression(_) => format!("({value_source} || \"\")"),
        _ => format!("(({value_source}) || \"\")"),
    }
}

/// Whether a generated CSS rule is the root rule of `class_name`, including `@layer` sections
pub(super) fn is_class_rule(rule: &str, class_name: &str) -> bool {
    let selector = format!(".{class_name} {{");
    rule.starts_with(&selector)
        || rule
            .strip_prefix("@layer ")
            .and_then(|layered| layered.split_once(" {\n  "))
            .is_some_and(|(_, inner)| inner.starts_with(&selector))
}

/// Replaces `&.original` modifier selectors with `&.hashed`, skipping longer class names
/// that share the same prefix, e.g. `&.active-extra` when replacing `active`
pub(super) fn replace_modifier_selector(css: &str, original: &str, hashed: &str) -> String {
    let mut result = String::with_capacity(css.len());
    let mut last = 0;
    for start in modifier_selector_starts(css, original) {
        result.push_str(&css[last..=start]);
        result.push_str(hashed);
        last = start + 1 + original.len();
    }
    result.push_str(&css[last..]);
    result
}

/// Whether `css` has a `&.original` modifier selector, ignoring longer class names that share
/// the same prefix
pub(super) fn contains_modifier_selector(css: &str, original: &str) -> bool {
    !modifier_selector_starts(css, original).is_empty()
}

/// Byte offsets of the `.` of each `.original` class in a compound selector starting with `&`,
/// e.g. both classes of `&.active.disabled`, skipping strings and comments
fn modifier_selector_starts(css: &str, original: &str) -> Vec<usize> {
    let bytes = css.as_bytes();
    let pattern = format!(".{original}");
    let mut starts = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            quote @ (b'"' | b'\'') => {
                index += 1;
                while index < bytes.len() && bytes[index] != quote {
                    index += if bytes[index] == b'\\' { 2 } else { 1 };
                }
                index += 1;
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index = css[index + 2..]
                    .find("*/")
                    .map_or(bytes.len(), |end| index + 2 + end + 2);
            }
            b'.' if css[index..].starts_with(&pattern)
                && is_class_name_end(&css[index + pattern.len()..])
                && is_compound_of_parent(&css[..index]) =>
            {
                starts.push(index);
                index += pattern.len();
            }
            _ => index += 1,
        }
    }
    starts
}

/// Whether the selector text before a class continues a compound selector of `&`
fn is_compound_of_parent(before: &str) -> bool {
    let parent =
        before.trim_end_matches(|character| character == '.' || is_class_name_character(character));
    let chain = &before[parent.len()..];
    parent.ends_with('&') && (chain.is_empty() || chain.starts_with('.'))
}

fn is_class_name_end(rest: &str) -> bool {
    rest.chars()
        .next()
        .is_none_or(|character| !is_class_name_character(character))
}

fn is_class_name_character(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '-' | '_') || !character.is_ascii()
}

/// `mergeClassNames` inputs: spread props and explicit `className` values in source order,
/// plus the spans of the `className` attributes they replace
pub(super) fn merge_class_name_inputs(
    element: &JSXElement<'_>,
    source: &str,
    constants: &FxHashMap<String, crate::facts::StaticValue>,
    scoping: &Scoping,
) -> (Vec<String>, Vec<oxc_span::Span>) {
    let mut inputs = Vec::new();
    let mut replaced_attributes = Vec::new();
    for item in &element.opening_element.attributes {
        match item {
            JSXAttributeItem::SpreadAttribute(spread) => {
                let span = spread.argument.span();
                inputs.push(source[span.start as usize..span.end as usize].to_owned());
            }
            JSXAttributeItem::Attribute(attribute)
                if is_named_attribute(attribute, "className") =>
            {
                inputs.push(class_name_concat_source(
                    attribute, source, constants, scoping,
                ));
                replaced_attributes.push(attribute.span);
            }
            JSXAttributeItem::Attribute(_) => {}
        }
    }
    (inputs, replaced_attributes)
}

/// Rewrites a JSX attribute string keeping its raw content and quotes, so entities still work
pub(super) fn wrap_jsx_string(
    value: &oxc_ast::ast::StringLiteral<'_>,
    source: &str,
    prefix: &str,
    suffix: &str,
) -> String {
    let raw = &source[value.span.start as usize..value.span.end as usize];
    let quote = &raw[..1];
    let content = &raw[1..raw.len() - 1];
    format!("{quote}{prefix}{content}{suffix}{quote}")
}

/// Serializes a value as a double-quoted JS string literal
pub(super) fn js_string_literal(value: &str) -> String {
    let mut literal = String::with_capacity(value.len() + 2);
    literal.push('"');
    for character in value.chars() {
        match character {
            '"' => literal.push_str("\\\""),
            '\\' => literal.push_str("\\\\"),
            '\n' => literal.push_str("\\n"),
            '\r' => literal.push_str("\\r"),
            '\u{2028}' => literal.push_str("\\u2028"),
            '\u{2029}' => literal.push_str("\\u2029"),
            character => literal.push(character),
        }
    }
    literal.push('"');
    literal
}

/// Decodes the HTML entities of a JSX attribute string, e.g. `&quot;`, `&#34;` or `&#x22;`
pub(super) fn decode_jsx_entities(value: &str) -> String {
    let mut decoded = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('&') {
        decoded.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after
            .find(';')
            .and_then(|end| decode_jsx_entity(&after[..end]).map(|character| (character, end)))
        {
            Some((character, end)) => {
                decoded.push(character);
                rest = &after[end + 1..];
            }
            None => {
                decoded.push('&');
                rest = after;
            }
        }
    }
    decoded.push_str(rest);
    decoded
}

fn decode_jsx_entity(entity: &str) -> Option<char> {
    let Some(number) = entity.strip_prefix('#') else {
        return oxc_syntax::xml_entities::XML_ENTITIES.get(entity).copied();
    };
    let code = match number.strip_prefix('x') {
        Some(hex) if !hex.is_empty() && hex.bytes().all(|byte| byte.is_ascii_hexdigit()) => {
            u32::from_str_radix(hex, 16).ok()?
        }
        None if !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit()) => {
            number.parse().ok()?
        }
        _ => return None,
    };
    char::from_u32(code)
}

pub(super) fn opening_attribute_insertion_offset(element: &JSXElement<'_>, source: &str) -> u32 {
    let end = element.opening_element.span.end.saturating_sub(1);
    if source.as_bytes().get(end.saturating_sub(1) as usize) == Some(&b'/') {
        end.saturating_sub(1)
    } else {
        end
    }
}
