use std::ops::Range;

use oxc_css_parser::Allocator;
use rustc_hash::FxHashMap;

use crate::facts::{StaticValue, StyleFlagClass};

use super::css_syntax::{CssError, parse_style_block};
use super::css_tokens::is_ident_char;
use super::cx_modifier_selectors::{
    ElementClass, StyleBlockClasses, referenced_classes, rewrite_classes, style_block_classes,
};
use super::styled::{StyleFlag, StyleFlagKind, StyledComponent};
use super::styled_jsx_helpers::is_class_rule;

pub(crate) fn flag_classes(flags: &[StyleFlag]) -> Vec<StyleFlagClass> {
    flags
        .iter()
        .flat_map(|flag| match &flag.kind {
            StyleFlagKind::Boolean => vec![StyleFlagClass {
                original: flag.prop_name.clone(),
                hashed: flag.hashed_class_name.clone(),
            }],
            StyleFlagKind::StringUnion(values) => values
                .iter()
                .map(|value| StyleFlagClass {
                    original: format!("{}-{value}", flag.prop_name),
                    hashed: format!("{}-{value}", flag.hashed_class_name),
                })
                .collect(),
        })
        .collect()
}

/// The flag classes of a styled component, with the flags of a base it renders, which the base
/// applies itself, e.g. `active` of an imported `Base` in `styled(Base)`. Fails for a flag with
/// the prop of one of those, the base would never get the prop
pub(crate) fn all_flag_classes(
    base_name: Option<&str>,
    base_flags: &[StyleFlag],
    own_flags: &[StyleFlag],
    flags: &[StyleFlag],
    constants: &FxHashMap<String, StaticValue>,
) -> Result<Vec<StyleFlagClass>, String> {
    let mut classes = flag_classes(flags);
    let Some((
        base_name,
        StaticValue::ClassName {
            style_flags: base_classes,
            ..
        },
    )) = base_name.and_then(|name| Some((name, constants.get(name)?)))
    else {
        return Ok(classes);
    };
    let compiled_base_classes = flag_classes(base_flags);
    for class in base_classes {
        if compiled_base_classes
            .iter()
            .any(|compiled| compiled.original == class.original)
        {
            continue;
        }
        if let Some(own) = own_flags.iter().find(|own| {
            class
                .original
                .strip_prefix(own.prop_name.as_str())
                .is_some_and(|rest| rest.is_empty() || rest.starts_with('-'))
        }) {
            return Err(format!(
                "Style flag `{}` is also a style flag of `{}`, which would no longer get the prop, use another name",
                own.prop_name, base_name
            ));
        }
        classes.push(class.clone());
    }
    Ok(classes)
}

/// The class selectors of a styled component CSS, with the classes of the element itself named as
/// written in the CSS, so escaped classes like `&.\61 ctive` are not flag classes
pub(crate) fn style_classes(css: &str) -> Result<StyleBlockClasses, CssError> {
    let mut classes = style_block_classes(css)?;
    for class in &mut classes.element {
        if let Some(name) = css.get(class.start..class.end) {
            name.clone_into(&mut class.name);
        }
    }
    Ok(classes)
}

/// The flag classes used in selectors of other elements, e.g. `active` in `.active > &` or
/// `& .active`. They are kept as written, so they don't select elements with the flag
pub(crate) fn other_element_flag_classes(
    css: &str,
    other_classes: &[Range<usize>],
    flags: &[StyleFlagClass],
) -> Vec<String> {
    flags
        .iter()
        .filter(|flag| {
            other_classes
                .iter()
                .any(|range| css.get(range.clone()) == Some(flag.original.as_str()))
        })
        .map(|flag| flag.original.clone())
        .collect()
}

/// Renames the flag classes of the element selectors to their hashed names. Fails for flag classes
/// of rules that match both the element and other elements, renaming them would break the other
/// elements
pub(crate) fn rewrite_style_flag_selectors(
    css: &str,
    classes: &[ElementClass],
    flags: &[StyleFlagClass],
) -> Result<String, CssError> {
    let mappings = flags
        .iter()
        .map(|flag| (flag.original.clone(), flag.hashed.clone(), true))
        .collect::<Vec<_>>();
    rewrite_classes(css, classes, &mappings, |name| {
        format!(
            "Style flag \"{name}\" can't be used in a rule that matches both the element and other elements, like \"&.{name}\" nested in \"&:hover, & .child\" or \":where(&, .x)\". Split the selectors into separate rules."
        )
    })
}

/// A style flag error of a rule selecting a styled component through a reference to it, located
/// at the declaration of `component`
pub(crate) struct ReferencedFlagError {
    pub component: String,
    pub error: CssError,
}

/// Renames the flag classes selected through a reference to a styled component to their hashed
/// names, e.g. `active` in `${Item}.active &`, `:is(${Item}).active &` or
/// `& ${Item} { &.active { ... } }`. Fails for flag classes of rules that match both the component
/// and other elements, renaming them would break the other elements
pub(crate) fn hash_referenced_style_flags(
    css_rules: &mut [String],
    constants: &FxHashMap<String, StaticValue>,
    components: &FxHashMap<String, StyledComponent>,
) -> Result<(), ReferencedFlagError> {
    // Imported styled components carry the flags hashed by their own module
    let references = constants
        .iter()
        .filter_map(|(name, value)| match value {
            StaticValue::ClassName {
                name: class_name,
                style_flags,
            } if !style_flags.is_empty() => Some((name.as_str(), class_name, style_flags)),
            _ => None,
        })
        .collect::<Vec<_>>();
    for rule in css_rules.iter_mut() {
        let referenced = references
            .iter()
            .filter(|(_, class_name, _)| references_class(rule, class_name))
            .collect::<Vec<_>>();
        let Some((first, _, _)) = referenced.first() else {
            continue;
        };
        // The rule owner is the nearest location, the CSS offsets don't map to the source
        let owner = components
            .iter()
            .find(|(_, component)| {
                component
                    .class_name
                    .split_whitespace()
                    .last()
                    .is_some_and(|class_name| is_class_rule(rule, class_name))
            })
            .map_or(*first, |(name, _)| name.as_str());
        let located = |error| ReferencedFlagError {
            component: owner.to_owned(),
            error,
        };
        let allocator = Allocator::default();
        let stylesheet = parse_style_block(&allocator, rule).map_err(located)?;
        let mut renames = Vec::new();
        for (name, class_name, flags) in referenced {
            for class in referenced_classes(
                &stylesheet.statements,
                std::slice::from_ref(class_name),
                &[],
            ) {
                let Some(flag) = flags.iter().find(|flag| flag.original == class.name) else {
                    continue;
                };
                if class.mixed {
                    return Err(located(CssError::new(
                        format!(
                            "Style flag \"{0}\" of \"{name}\" can't be used in a rule that matches both \"{name}\" and other elements, like \"&.{0}\" nested in \"${{{name}}}, .x\". Split the selectors into separate rules.",
                            flag.original
                        ),
                        class.start,
                        class.end,
                    )));
                }
                renames.push((class.start..class.end, flag.hashed.as_str()));
            }
        }
        if renames.is_empty() {
            continue;
        }
        // A class can be selected through several references, e.g. `.item.other.active`
        renames.sort_by_key(|(range, _)| range.start);
        renames.dedup_by_key(|(range, _)| range.start);
        let mut renamed = String::with_capacity(rule.len());
        let mut last = 0;
        for (range, hashed) in renames {
            renamed.push_str(&rule[last..range.start]);
            renamed.push_str(hashed);
            last = range.end;
        }
        renamed.push_str(&rule[last..]);
        *rule = renamed;
    }
    Ok(())
}

/// If the rule selects the component class, other than as the selector of the component's own
/// rule, e.g. `.item` in `.list { & .item.active { ... } }`
fn references_class(rule: &str, class_name: &str) -> bool {
    let selector = format!(".{class_name}");
    let selections = rule
        .match_indices(&selector)
        .filter(|(index, _)| !rule[index + selector.len()..].starts_with(is_ident_char))
        .count();
    selections > usize::from(is_class_rule(rule, class_name))
}

/// The flag classes not used by the element, e.g. `active` without a `&.active` selector
pub(crate) fn missing_style_flag_classes(
    classes: &[ElementClass],
    flags: &[StyleFlag],
) -> Vec<String> {
    flag_classes(flags)
        .into_iter()
        .filter(|flag| !classes.iter().any(|class| class.name == flag.original))
        .map(|flag| flag.original)
        .collect()
}

/// The classes of the element that are not style flags
pub(crate) fn undeclared_style_classes(
    classes: &[ElementClass],
    flags: &[StyleFlagClass],
) -> Vec<String> {
    let mut undeclared: Vec<String> = Vec::new();
    for class in classes {
        if !flags.iter().any(|flag| flag.original == class.name)
            && !undeclared.contains(&class.name)
        {
            undeclared.push(class.name.clone());
        }
    }
    undeclared
}

#[cfg(test)]
mod tests {
    use super::references_class;

    #[test]
    fn finds_rules_selecting_a_component_class() {
        assert_eq!(
            [
                ".list {\n  & .v-1.active { color: red; }\n}",
                ".v-1 {\n  & .v-1 { color: red; }\n}",
                ".v-1 {\n  &.v-2 { color: red; }\n}",
                ".list {\n  & .v-10.active { color: red; }\n}",
                ".list {\n  & .v-1-a.active { color: red; }\n}",
            ]
            .map(|rule| references_class(rule, "v-1")),
            [true, true, false, false, false]
        );
    }
}
