use oxc_ast::ast::{IdentifierReference, JSXAttributeValue, JSXElement, JSXExpression};
use oxc_ast_visit::Visit;
use oxc_semantic::Scoping;
use rustc_hash::{FxHashMap, FxHashSet};

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
    /// A local css exported to other files, which don't get its renamed modifiers
    exported: bool,
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
    exported_names: &FxHashMap<String, String>,
) -> Vec<CssReference> {
    ["className", "css"]
        .into_iter()
        .filter_map(|attribute_name| {
            let JSXExpression::Identifier(identifier) =
                attribute_expression(element, attribute_name)?
            else {
                return None;
            };
            css_reference(identifier, constants, scoping, exported_names)
        })
        .collect()
}

/// The `css` function references inside a `className` expression that is not a single
/// reference, e.g. `styles` in `className={cx(styles)}`, their modifiers are not renamed
pub(super) fn wrapped_css_references(
    element: &JSXElement<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    exported_names: &FxHashMap<String, String>,
) -> Vec<CssReference> {
    let Some(expression) = attribute_expression(element, "className") else {
        return Vec::new();
    };
    if matches!(expression, JSXExpression::Identifier(_)) {
        return Vec::new();
    }
    let mut collector = CssReferenceCollector {
        constants,
        scoping,
        exported_names,
        references: Vec::new(),
    };
    collector.visit_jsx_expression(expression);
    collector.references
}

fn attribute_expression<'a>(
    element: &'a JSXElement<'a>,
    attribute_name: &str,
) -> Option<&'a JSXExpression<'a>> {
    let attribute = find_last_attribute(element, attribute_name)?;
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return None;
    };
    Some(&container.expression)
}

fn css_reference(
    identifier: &IdentifierReference<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    exported_names: &FxHashMap<String, String>,
) -> Option<CssReference> {
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
    let exported = !imported
        && exported_names.values().any(|local_name| {
            matches!(
                constants.get(local_name),
                Some(StaticValue::CssClass { name: exported_class, .. }) if exported_class == name
            )
        });
    Some(CssReference {
        name: name.clone(),
        css: css.clone(),
        identifier: identifier.name.to_string(),
        span: identifier.span,
        imported,
        exported,
    })
}

struct CssReferenceCollector<'c> {
    constants: &'c FxHashMap<String, StaticValue>,
    scoping: &'c Scoping,
    exported_names: &'c FxHashMap<String, String>,
    references: Vec<CssReference>,
}

impl<'a> Visit<'a> for CssReferenceCollector<'_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        self.references.extend(css_reference(
            identifier,
            self.constants,
            self.scoping,
            self.exported_names,
        ));
    }
}

/// Hashed cx modifiers are only rewritten in the styled component css or in local css
/// references, so fail when a reference that is not rewritten, or exported to files that don't
/// get the renamed modifiers, declares one of them
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
        .filter(|reference| reference.imported || reference.exported || is_styled)
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
    if let Some(reference) = local.iter().find(|reference| reference.exported) {
        return Some((
            reference.span,
            format!(
                "cx prop modifiers can't be used with the exported css reference \"{}\", other files using it would not get the hashed modifier classes. Use $-prefixed classes (e.g. $active) or a styled component.",
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

/// Css references wrapped in a `className` expression are not renamed, so fail when one declares
/// a hashed cx modifier, also when cx props of other elements already renamed it
pub(super) fn wrapped_css_reference_modifiers(
    wrapped: &[CssReference],
    mappings: &[(String, String, bool)],
    renamed_modifiers: &FxHashSet<(String, String)>,
) -> Option<(oxc_span::Span, String)> {
    if !rewrites_any(mappings) {
        return None;
    }
    for reference in wrapped {
        let renamed = mappings.iter().any(|(original, _, should_rewrite)| {
            *should_rewrite
                && renamed_modifiers.contains(&(reference.name.clone(), original.clone()))
        });
        match declares_rewritten_modifier(reference, mappings) {
            Ok(declares) if declares || renamed => {
                return Some((
                    reference.span,
                    format!(
                        "cx prop modifiers can't be used with the css reference \"{0}\" inside a className expression, its modifier styles are only hashed when it's passed directly. Use className={{{0}}} or $-prefixed classes (e.g. $active).",
                        reference.identifier
                    ),
                ));
            }
            Ok(_) => {}
            Err(error) => return Some((reference.span, error.message)),
        }
    }
    None
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

/// The class of the mapping `rewrite_class_rules` fails on, so the error is reported at its cx key
pub(super) fn failing_modifier<'m>(
    css_rules: &[String],
    class_names: &[String],
    mappings: &'m [(String, String, bool)],
) -> Option<&'m str> {
    mappings
        .iter()
        .find(|mapping| {
            css_rules
                .iter()
                .filter(|rule| {
                    class_names
                        .iter()
                        .any(|class_name| is_class_rule(rule, class_name))
                })
                .any(|rule| {
                    rewrite_modifiers(rule, ModifierCss::ClassRule, std::slice::from_ref(mapping))
                        .is_err()
                })
        })
        .map(|(original, _, _)| original.as_str())
}
