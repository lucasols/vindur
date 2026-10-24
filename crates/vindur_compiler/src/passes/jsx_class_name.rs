use oxc_ast::ast::{
    JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElement, JSXExpression,
    StringLiteral,
};
use oxc_span::{GetSpan, Span};
use oxc_syntax::xml_entities::XML_ENTITIES;

use crate::edit::Edit;

pub(super) enum ClassNameMerge<'a> {
    // No later spread can override the last explicit className, so vindur's
    // classes are merged into it in place
    InPlace(&'a JSXAttribute<'a>),
    // A later spread may set className, so the classes are merged at runtime
    Runtime(RuntimeClassInputs),
    // No className or spreads, so a new className is added
    Insert,
}

pub(super) struct RuntimeClassInputs {
    // The last explicit className and the spreads after it, in source order,
    // for `mergeClassNames`' last-one-wins semantics
    pub inputs: Vec<String>,
    // The explicit className moved into `inputs`, earlier ones are overridden anyway
    pub moved_class_name: Option<Span>,
}

pub(super) fn class_name_merge<'a>(
    element: &'a JSXElement<'a>,
    source: &str,
) -> ClassNameMerge<'a> {
    let attributes = &element.opening_element.attributes;
    let last_spread = attributes
        .iter()
        .rposition(|item| matches!(item, JSXAttributeItem::SpreadAttribute(_)));
    let last_class_name = attributes
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, item)| class_name_attribute(item).map(|attribute| (index, attribute)));
    let Some(last_spread) = last_spread else {
        return last_class_name.map_or(ClassNameMerge::Insert, |(_, attribute)| {
            ClassNameMerge::InPlace(attribute)
        });
    };
    if let Some((index, attribute)) = last_class_name
        && index > last_spread
    {
        return ClassNameMerge::InPlace(attribute);
    }
    let start = last_class_name.map_or(0, |(index, _)| index);
    let inputs = attributes[start..]
        .iter()
        .filter_map(|item| match item {
            JSXAttributeItem::SpreadAttribute(spread) => {
                Some(source_text(source, spread.argument.span()).to_owned())
            }
            JSXAttributeItem::Attribute(attribute) => {
                class_name_attribute(item).map(|_| explicit_class_input(attribute, source))
            }
        })
        .collect();
    ClassNameMerge::Runtime(RuntimeClassInputs {
        inputs,
        moved_class_name: last_class_name.map(|(_, attribute)| attribute.span),
    })
}

fn class_name_attribute<'a>(item: &'a JSXAttributeItem<'a>) -> Option<&'a JSXAttribute<'a>> {
    let JSXAttributeItem::Attribute(attribute) = item else {
        return None;
    };
    matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "className")
        .then_some(attribute)
}

// Wrapped in an object so a nullish explicit className still overrides
// earlier spreads, like it does in JSX
pub(super) fn explicit_class_input(attribute: &JSXAttribute<'_>, source: &str) -> String {
    match &attribute.value {
        Some(JSXAttributeValue::StringLiteral(value)) => jsx_string_literal(&value.value),
        Some(JSXAttributeValue::ExpressionContainer(container))
            if !matches!(container.expression, JSXExpression::EmptyExpression(_)) =>
        {
            format!(
                "{{ className: {} }}",
                source_text(source, container.expression.span())
            )
        }
        _ => "{ className: undefined }".to_owned(),
    }
}

// Merges `class_expression` into an expression className in place. Only the
// text around the expression is edited, so edits other passes make inside it
// still apply. Returns `None` for string and valueless classNames
pub(super) fn wrap_class_expression(
    attribute: &JSXAttribute<'_>,
    class_expression: &str,
) -> Option<[Edit; 2]> {
    wrap_attribute_expression(
        attribute,
        "className={[",
        &format!(", {class_expression}].filter(Boolean).join(\" \")}}"),
    )
}

// Replaces the text before and after an expression attribute's value, keeping
// edits other passes make inside it
pub(super) fn wrap_attribute_expression(
    attribute: &JSXAttribute<'_>,
    prefix: &str,
    suffix: &str,
) -> Option<[Edit; 2]> {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return None;
    };
    if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
        return None;
    }
    let expression = container.expression.span();
    Some([
        Edit {
            span: Span::new(attribute.span.start, expression.start),
            replacement: prefix.to_owned(),
        },
        Edit {
            span: Span::new(expression.end, attribute.span.end),
            replacement: suffix.to_owned(),
        },
    ])
}

// JSX strings can't escape their quote, so the original quote is kept
pub(super) fn extend_jsx_string(
    value: &StringLiteral<'_>,
    source: &str,
    prefix: &str,
    suffix: &str,
) -> String {
    let quote = source_text(source, value.span)
        .chars()
        .next()
        .unwrap_or('"');
    format!("{quote}{prefix}{}{suffix}{quote}", value.value)
}

fn source_text(source: &str, span: Span) -> &str {
    &source[span.start as usize..span.end as usize]
}

// JSX attribute strings have no escape sequences but decode HTML entities, so
// their raw text can't be pasted into a JS string literal
pub(super) fn jsx_string_value(raw: &str) -> String {
    let mut output = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find('&') {
        output.push_str(&rest[..start]);
        rest = &rest[start..];
        let decoded = rest
            .find(';')
            .and_then(|end| decode_entity(&rest[1..end]).map(|character| (character, end)));
        match decoded {
            Some((character, end)) => {
                output.push(character);
                rest = &rest[end + 1..];
            }
            None => {
                output.push('&');
                rest = &rest[1..];
            }
        }
    }
    output.push_str(rest);
    output
}

fn decode_entity(entity: &str) -> Option<char> {
    if let Some(hex) = entity
        .strip_prefix("#x")
        .or_else(|| entity.strip_prefix("#X"))
    {
        return u32::from_str_radix(hex, 16).ok().and_then(char::from_u32);
    }
    if let Some(decimal) = entity.strip_prefix('#') {
        return decimal.parse().ok().and_then(char::from_u32);
    }
    XML_ENTITIES.get(entity).copied()
}

pub(super) fn js_string_literal(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\u{2028}' => output.push_str("\\u2028"),
            '\u{2029}' => output.push_str("\\u2029"),
            character => output.push(character),
        }
    }
    output.push('"');
    output
}

pub(super) fn jsx_string_literal(raw: &str) -> String {
    js_string_literal(&jsx_string_value(raw))
}

#[cfg(test)]
mod tests {
    use super::{jsx_string_literal, jsx_string_value};

    #[test]
    fn decodes_entities() {
        assert_eq!(
            jsx_string_value("a &amp; b &#65; &#x42; &unknown; &"),
            "a & b A B &unknown; &"
        );
    }

    #[test]
    fn escapes_js_string() {
        assert_eq!(jsx_string_literal("a\\b\n\"c\""), "\"a\\\\b\\n\\\"c\\\"\"");
    }
}
