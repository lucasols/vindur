use oxc_ast::ast::{JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXElement, JSXElementName};
use oxc_span::GetSpan;

pub(super) fn jsx_name<'a>(name: &'a JSXElementName<'a>) -> Option<&'a str> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

pub(super) fn attribute_name<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    let JSXAttributeName::Identifier(identifier) = &attribute.name else {
        return None;
    };
    Some(identifier.name.as_str())
}

pub(super) fn find_attribute<'a>(
    element: &'a JSXElement<'a>,
    name: &str,
) -> Option<&'a JSXAttribute<'a>> {
    find_attributes(element, name).next()
}

pub(super) fn find_attributes<'a>(
    element: &'a JSXElement<'a>,
    name: &str,
) -> impl Iterator<Item = &'a JSXAttribute<'a>> {
    element
        .opening_element
        .attributes
        .iter()
        .filter_map(move |item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return None;
            };
            (attribute_name(attribute) == Some(name)).then_some(&**attribute)
        })
}

pub(super) fn find_last_attribute<'a>(
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
            (attribute_name(attribute) == Some(name)).then_some(&**attribute)
        })
}

// Where an attribute can be appended to the opening element: right before its `/>` or `>`,
// after the last attribute and any comments that follow it
pub(super) fn opening_attribute_insertion_offset(element: &JSXElement<'_>, source: &str) -> u32 {
    let opening = &element.opening_element;
    let end = opening.span.end.saturating_sub(1) as usize;
    let mut index = opening
        .attributes
        .last()
        .map(|attribute| attribute.span().end)
        .or_else(|| {
            opening
                .type_arguments
                .as_ref()
                .map(|arguments| arguments.span.end)
        })
        .unwrap_or_else(|| opening.name.span().end) as usize;
    while let Some(rest) = source.get(index..end) {
        let Some(character) = rest.chars().next() else {
            break;
        };
        index = if rest.starts_with("/*") {
            rest.find("*/")
                .map_or(end, |comment_end| index + comment_end + 2)
        } else if rest.starts_with("//") {
            rest.char_indices()
                .find(|(_, character)| matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
                .map_or(end, |(line_end, terminator)| {
                    index + line_end + terminator.len_utf8()
                })
        } else if character == '/' {
            return u32::try_from(index).unwrap_or(opening.span.end);
        } else {
            index + character.len_utf8()
        };
    }
    u32::try_from(end).unwrap_or(opening.span.end)
}
