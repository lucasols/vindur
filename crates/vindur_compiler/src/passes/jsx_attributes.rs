use oxc_ast::ast::{JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXElement, JSXElementName};

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
    element.opening_element.attributes.iter().find_map(|item| {
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

// Where an attribute can be appended to the opening element, before `>` or `/>`
pub(super) fn opening_attribute_insertion_offset(element: &JSXElement<'_>, source: &str) -> u32 {
    let end = element.opening_element.span.end.saturating_sub(1);
    if source.as_bytes().get(end.saturating_sub(1) as usize) == Some(&b'/') {
        end.saturating_sub(1)
    } else {
        end
    }
}
