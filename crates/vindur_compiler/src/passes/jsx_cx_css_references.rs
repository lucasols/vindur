use oxc_ast::ast::{JSXAttributeValue, JSXElement, JSXExpression};
use oxc_semantic::Scoping;
use rustc_hash::FxHashMap;

use crate::facts::StaticValue;

use super::{
    css_syntax::CssError,
    cx_modifier_selectors::{ModifierCss, element_class_names, rewrite_modifiers, rewrites_any},
    jsx_attributes::find_last_attribute,
    static_evaluation::resolved_constant,
    styled_jsx_helpers::is_class_rule,
};

pub(super) struct CssReference {
    name: String,
    css: String,
    identifier: String,
    span: oxc_span::Span,
    imported: bool,
}

impl CssReference {
    /// The class name of the referenced css
    pub(super) fn name(&self) -> &str {
        &self.name
    }
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
    if !rewrites_any(mappings) {
        return None;
    }
    let mut declaring = Vec::new();
    // Local references of other elements are rewritten in place
    for reference in css_references
        .iter()
        .filter(|reference| reference.imported || is_styled)
    {
        match declares_rewritten_modifier(reference, mappings) {
            Ok(true) => declaring.push(reference),
            Ok(false) => {}
            Err(error) => return Some((reference.span, error.message)),
        }
    }
    let (imported, local): (Vec<_>, Vec<_>) = declaring
        .into_iter()
        .partition(|reference| reference.imported);
    if let Some(reference) = imported.first() {
        return Some((
            reference.span,
            format!(
                "cx prop modifiers can't be used with the imported css reference \"{}\", its styles are defined in another file. Use $-prefixed classes (e.g. $active) or define the modifier styles locally.",
                reference.identifier
            ),
        ));
    }
    let reference = local.first().filter(|_| is_styled)?;
    Some((
        reference.span,
        format!(
            "cx prop modifiers can't be used on styled component \"{element_name}\" with the css reference \"{}\". Move the modifier styles into the styled component or use $-prefixed classes (e.g. $active).",
            reference.identifier
        ),
    ))
}

fn declares_rewritten_modifier(
    reference: &CssReference,
    mappings: &[(String, String, bool)],
) -> Result<bool, CssError> {
    let declared = element_class_names(&reference.css, ModifierCss::Block)?;
    Ok(mappings
        .iter()
        .any(|(original, _, should_rewrite)| *should_rewrite && declared.contains(original)))
}

pub(super) fn rewrite_class_rules(
    css_rules: &mut [String],
    class_names: &[String],
    mappings: &[(String, String, bool)],
) -> Result<(), CssError> {
    if !rewrites_any(mappings) {
        return Ok(());
    }
    for rule in css_rules.iter_mut().filter(|rule| {
        class_names
            .iter()
            .any(|class_name| is_class_rule(rule, class_name))
    }) {
        *rule = rewrite_modifiers(rule, ModifierCss::ClassRule, mappings)?;
    }
    Ok(())
}
