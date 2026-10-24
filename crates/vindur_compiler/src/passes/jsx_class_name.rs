use oxc_ast::ast::{
    JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElement, JSXExpression,
};
use oxc_span::{GetSpan, Span};
use oxc_syntax::xml_entities::XML_ENTITIES;

pub(super) struct SpreadClassInputs {
    pub inputs: Vec<String>,
    pub class_name_spans: Vec<Span>,
}

// Spreads and explicit `className`s in source order, so `mergeClassNames` keeps
// JSX's last-one-wins semantics. Returns `None` when the element has no spreads
pub(super) fn spread_class_inputs(
    element: &JSXElement<'_>,
    source: &str,
) -> Option<SpreadClassInputs> {
    let mut has_spread = false;
    let mut inputs = Vec::new();
    let mut class_name_spans = Vec::new();
    for item in &element.opening_element.attributes {
        match item {
            JSXAttributeItem::SpreadAttribute(spread) => {
                has_spread = true;
                let span = spread.argument.span();
                inputs.push(source[span.start as usize..span.end as usize].to_owned());
            }
            JSXAttributeItem::Attribute(attribute) if matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "className") =>
            {
                class_name_spans.push(attribute.span);
                match &attribute.value {
                    Some(JSXAttributeValue::StringLiteral(value)) => {
                        inputs.push(jsx_string_literal(&value.value));
                    }
                    Some(JSXAttributeValue::ExpressionContainer(container))
                        if !matches!(container.expression, JSXExpression::EmptyExpression(_)) =>
                    {
                        let span = container.expression.span();
                        inputs.push(source[span.start as usize..span.end as usize].to_owned());
                    }
                    _ => {}
                }
            }
            JSXAttributeItem::Attribute(_) => {}
        }
    }
    has_spread.then_some(SpreadClassInputs {
        inputs,
        class_name_spans,
    })
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
