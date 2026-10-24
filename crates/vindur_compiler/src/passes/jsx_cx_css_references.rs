use oxc_ast::ast::{JSXAttributeValue, JSXElement, JSXExpression};
use oxc_semantic::Scoping;
use rustc_hash::FxHashMap;

use crate::facts::StaticValue;

use super::{
    jsx_cx::find_last_attribute,
    static_evaluation::resolved_constant,
    styled_jsx_helpers::{contains_modifier_selector, is_class_rule, replace_modifier_selector},
};

pub(super) struct CssReference {
    name: String,
    css: String,
    identifier: String,
    span: oxc_span::Span,
    imported: bool,
}

pub(super) fn class_name_is_css_reference(
    element: &JSXElement<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> bool {
    let Some(attribute) = find_last_attribute(element, "className") else {
        return false;
    };
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return false;
    };
    let JSXExpression::Identifier(identifier) = &container.expression else {
        return false;
    };
    matches!(
        resolved_constant(identifier, constants, scoping),
        Some(StaticValue::CssClass { .. })
    )
}

/// The `css` function references used in `className` or `css`
pub(super) fn css_references(
    element: &JSXElement<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Vec<CssReference> {
    ["className", "css"]
        .into_iter()
        .filter_map(|attribute_name| {
            let attribute = find_last_attribute(element, attribute_name)?;
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                return None;
            };
            let JSXExpression::Identifier(identifier) = &container.expression else {
                return None;
            };
            let Some(StaticValue::CssClass { name, css }) =
                resolved_constant(identifier, constants, scoping)
            else {
                return None;
            };
            let imported = identifier
                .reference_id
                .get()
                .and_then(|id| scoping.get_reference(id).symbol_id())
                .is_some_and(|symbol_id| scoping.symbol_flags(symbol_id).is_import());
            Some(CssReference {
                name: name.clone(),
                css: css.clone(),
                identifier: identifier.name.to_string(),
                span: identifier.span,
                imported,
            })
        })
        .collect()
}

/// Hashed cx modifiers are only rewritten in the styled component css or in local css
/// references, so fail when a reference that is not rewritten declares one of them
pub(super) fn unsupported_css_reference_modifiers(
    element_name: &str,
    is_styled: bool,
    css_references: &[CssReference],
    mappings: &[(String, String, bool)],
) -> Option<(oxc_span::Span, String)> {
    let declares_rewritten_modifier = |reference: &&CssReference| {
        mappings.iter().any(|(original, _, should_rewrite)| {
            *should_rewrite && contains_modifier_selector(&reference.css, original)
        })
    };
    if let Some(reference) = css_references
        .iter()
        .filter(|reference| reference.imported)
        .find(declares_rewritten_modifier)
    {
        return Some((
            reference.span,
            format!(
                "cx prop modifiers can't be used with the imported css reference \"{}\", its styles are defined in another file. Use $-prefixed classes (e.g. $active) or define the modifier styles locally.",
                reference.identifier
            ),
        ));
    }
    let reference = css_references
        .iter()
        .filter(|_| is_styled)
        .find(declares_rewritten_modifier)?;
    Some((
        reference.span,
        format!(
            "cx prop modifiers can't be used on styled component \"{element_name}\" with the css reference \"{}\". Move the modifier styles into the styled component or use $-prefixed classes (e.g. $active).",
            reference.identifier
        ),
    ))
}

pub(super) fn rewrite_css_references(
    css_rules: &mut [String],
    references: &[CssReference],
    mappings: &[(String, String, bool)],
) {
    let names = references
        .iter()
        .map(|reference| reference.name.clone())
        .collect::<Vec<_>>();
    rewrite_class_rules(css_rules, &names, mappings);
}

pub(super) fn rewrite_class_rules(
    css_rules: &mut [String],
    class_names: &[String],
    mappings: &[(String, String, bool)],
) {
    for rule in css_rules.iter_mut().filter(|rule| {
        class_names
            .iter()
            .any(|class_name| is_class_rule(rule, class_name))
    }) {
        for (original, hashed, should_rewrite) in mappings {
            if *should_rewrite {
                *rule = replace_modifier_selector(rule, original, hashed);
            }
        }
    }
}
