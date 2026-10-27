use std::{borrow::Cow, ops::Range};

use oxc_css_parser::Allocator;
use rustc_hash::FxHashMap;

use super::css_syntax::{CssError, parse_style_block};
use super::cx_modifier_selectors::{
    ElementClass, ModifierCss, element_classes, rewrite_classes, style_block_classes,
};
use super::jsx_cx_component_references::referenced_classes;
use super::styled::{StyleFlag, StyleFlagKind, StyledComponent};

/// A class applied by a style flag, e.g. `size-small` for `size: 'small' | 'large'`
struct FlagClass {
    /// The class as written in the CSS, e.g. `$size-small`
    original: String,
    hashed: String,
}

fn flag_classes(flags: &[StyleFlag]) -> Vec<FlagClass> {
    flags
        .iter()
        .flat_map(|flag| match &flag.kind {
            StyleFlagKind::Boolean => vec![FlagClass {
                original: flag.prop_name.clone(),
                hashed: flag.hashed_class_name.clone(),
            }],
            StyleFlagKind::StringUnion(values) => values
                .iter()
                .map(|value| FlagClass {
                    original: format!("{}-{value}", flag.prop_name),
                    hashed: format!("{}-{value}", flag.hashed_class_name),
                })
                .collect(),
        })
        .collect()
}

/// A character of a class name, including the `$` of flag classes like `$active`
fn is_class_character(character: char) -> bool {
    !character.is_ascii()
        || character.is_ascii_alphanumeric()
        || matches!(character, '-' | '_' | '$')
}

/// `$` is not valid in a class name, so flag selectors like `&.$active` are parsed as `&._active`,
/// which keeps the CSS offsets
fn parsable_css<'a>(css: &'a str, flags: &[StyleFlag]) -> Cow<'a, str> {
    if !flags.iter().any(|flag| flag.prop_name.contains('$')) {
        return Cow::Borrowed(css);
    }
    let mut parsable = String::with_capacity(css.len());
    let mut in_class = false;
    for character in css.chars() {
        if in_class && character == '$' {
            parsable.push('_');
            continue;
        }
        in_class = character == '.' || (in_class && is_class_character(character));
        parsable.push(character);
    }
    Cow::Owned(parsable)
}

/// The classes of the selectors of the element itself in a styled component CSS, named as written
/// in the CSS, as `$active` and `_active` are both parsed as `_active`
pub(crate) fn style_element_classes(
    css: &str,
    flags: &[StyleFlag],
) -> Result<Vec<ElementClass>, CssError> {
    let mut classes = element_classes(&parsable_css(css, flags), ModifierCss::Block)?;
    for class in &mut classes {
        if let Some(name) = css.get(class.start..class.end) {
            name.clone_into(&mut class.name);
        }
    }
    Ok(classes)
}

/// The CSS to validate, with the `$` of the flag classes of the element parsed as `_`. Fails for
/// `$` flag classes of other elements, like `& .$active` or `&:has(.$active)`, they are not valid
/// CSS, so they can only be used in selectors of the element, where they are replaced by the
/// hashed class. Escaped flag classes, like `&.\$active`, fail too, they wouldn't be hashed
pub(crate) fn flag_validation_css<'a>(
    css: &'a str,
    flags: &[StyleFlag],
) -> Result<Cow<'a, str>, CssError> {
    let parsable = parsable_css(css, flags);
    let Cow::Owned(parsable) = parsable else {
        return Ok(parsable);
    };
    // Invalid CSS fails the validation with the same error
    let Ok(classes) = style_block_classes(&parsable) else {
        return Ok(Cow::Owned(parsable));
    };
    let flag_classes = flag_classes(flags);
    let flag_at = |range: &Range<usize>| {
        let written = css.get(range.clone())?;
        flag_classes
            .iter()
            .find(|flag| flag.original == written.replace('\\', ""))
            .map(|flag| (flag, written.contains('\\')))
    };
    let element = classes.element.iter().map(|class| class.start..class.end);
    for range in element.clone().chain(classes.other.iter().cloned()) {
        if let Some((flag, true)) = flag_at(&range) {
            return Err(CssError::new(
                format!(
                    "Style flag \"{0}\" can't be escaped, write it as \"&.{0}\"",
                    flag.original
                ),
                range.start,
                range.end,
            ));
        }
    }
    for range in &classes.other {
        if let Some((flag, false)) = flag_at(range)
            && flag.original.contains('$')
        {
            return Err(CssError::new(
                format!(
                    "Style flag \"{0}\" can only be used in selectors of the element itself, e.g. \"&.{0}\"",
                    flag.original
                ),
                range.start,
                range.end,
            ));
        }
    }
    let mut validation = css.to_owned();
    for range in element {
        if flag_at(&range).is_some() {
            validation.replace_range(range.clone(), &parsable[range]);
        }
    }
    Ok(Cow::Owned(validation))
}

/// Renames the flag classes of the element selectors to their hashed names. Fails for flag classes
/// of rules that match both the element and other elements, renaming them would break the other
/// elements
pub(crate) fn rewrite_style_flag_selectors(
    css: &str,
    classes: &[ElementClass],
    flags: &[StyleFlag],
) -> Result<String, CssError> {
    let mappings = flag_classes(flags)
        .into_iter()
        .map(|flag| (flag.original, flag.hashed, true))
        .collect::<Vec<_>>();
    rewrite_classes(css, classes, &mappings, |name| {
        format!(
            "Style flag \"{name}\" can't be used in a rule that matches both the element and other elements, like \"&.{name}\" nested in \"&:hover, & .child\" or \":where(&, .x)\". Split the selectors into separate rules."
        )
    })
}

/// Renames the flag classes selected through a reference to a styled component to their hashed
/// names, e.g. `active` in `${Item}.active &`, `${Item}:hover.active &` or `${Item}:not(.active) &`
pub(crate) fn hash_referenced_style_flags(
    css_rules: &mut [String],
    components: &FxHashMap<String, StyledComponent>,
) -> Result<(), CssError> {
    let references = components
        .values()
        .filter(|component| !component.style_flags.is_empty())
        .filter_map(|component| {
            let class_name = component.class_name.split_whitespace().last()?;
            Some((class_name.to_owned(), flag_classes(&component.style_flags)))
        })
        .collect::<Vec<_>>();
    for rule in css_rules.iter_mut() {
        let referenced = references
            .iter()
            .filter(|(class_name, _)| rule.contains(class_name.as_str()))
            .collect::<Vec<_>>();
        if referenced.is_empty() {
            continue;
        }
        let allocator = Allocator::default();
        let stylesheet = parse_style_block(&allocator, rule)?;
        let mut renames = Vec::new();
        for (class_name, flags) in referenced {
            for class in referenced_classes(
                &stylesheet.statements,
                std::slice::from_ref(class_name),
                &[],
            ) {
                if let Some(flag) = flags.iter().find(|flag| flag.original == class.name) {
                    renames.push((class.start..class.end, flag.hashed.as_str()));
                }
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

/// The selectors of the flag classes not used by the element, e.g. `&.active`
pub(crate) fn missing_style_flag_selectors(
    classes: &[ElementClass],
    flags: &[StyleFlag],
) -> Vec<String> {
    flag_classes(flags)
        .into_iter()
        .filter(|flag| !classes.iter().any(|class| class.name == flag.original))
        .map(|flag| format!("&.{}", flag.original))
        .collect()
}

/// The classes of the element that are not style flags
pub(crate) fn undeclared_style_classes(
    classes: &[ElementClass],
    flags: &[StyleFlag],
) -> Vec<String> {
    let flag_classes = flag_classes(flags);
    let mut undeclared: Vec<String> = Vec::new();
    for class in classes {
        if !flag_classes.iter().any(|flag| flag.original == class.name)
            && !undeclared.contains(&class.name)
        {
            undeclared.push(class.name.clone());
        }
    }
    undeclared
}

#[cfg(test)]
mod tests {
    use super::{StyleFlag, StyleFlagKind, parsable_css};

    #[test]
    fn parses_dollar_classes_as_underscores() {
        let flags = [StyleFlag {
            hashed_class_name: "h-_active".to_owned(),
            kind: StyleFlagKind::Boolean,
            prop_name: "$active".to_owned(),
        }];
        assert_eq!(
            parsable_css("&.$active, &[href$=\"pdf\"] { color: red; }", &flags),
            "&._active, &[href$=\"pdf\"] { color: red; }"
        );
        assert_eq!(parsable_css("&.é$active {}", &flags), "&.é_active {}");
    }
}
