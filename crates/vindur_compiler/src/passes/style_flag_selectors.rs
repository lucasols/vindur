use std::borrow::Cow;

use super::css_syntax::CssError;
use super::cx_modifier_selectors::{ElementClass, ModifierCss, element_classes, rewrite_classes};
use super::styled::{StyleFlag, StyleFlagKind, css_class_name_part};

/// A class applied by a style flag, e.g. `size-small` for `size: 'small' | 'large'`
struct FlagClass {
    /// The class as written in the CSS, e.g. `$size-small`
    original: String,
    /// The class as parsed from the CSS, `$` is parsed as `_`, e.g. `_size-small`
    name: String,
    hashed: String,
}

fn flag_classes(flags: &[StyleFlag]) -> Vec<FlagClass> {
    flags
        .iter()
        .flat_map(|flag| {
            let name = css_class_name_part(&flag.prop_name);
            match &flag.kind {
                StyleFlagKind::Boolean => vec![FlagClass {
                    original: flag.prop_name.clone(),
                    name,
                    hashed: flag.hashed_class_name.clone(),
                }],
                StyleFlagKind::StringUnion(values) => values
                    .iter()
                    .map(|value| FlagClass {
                        original: format!("{}-{value}", flag.prop_name),
                        name: format!("{name}-{value}"),
                        hashed: format!("{}-{value}", flag.hashed_class_name),
                    })
                    .collect(),
            }
        })
        .collect()
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
        in_class = character == '.'
            || (in_class && (character.is_ascii_alphanumeric() || matches!(character, '-' | '_')));
        parsable.push(character);
    }
    Cow::Owned(parsable)
}

/// The classes of the selectors of the element itself in a styled component CSS
pub(crate) fn style_element_classes(
    css: &str,
    flags: &[StyleFlag],
) -> Result<Vec<ElementClass>, CssError> {
    element_classes(&parsable_css(css, flags), ModifierCss::Block)
}

/// The CSS to validate, with the `$` of the flag classes of the element parsed as `_`. `$` flag
/// classes of other elements are kept, so they fail the validation
pub(crate) fn flag_validation_css<'a>(css: &'a str, flags: &[StyleFlag]) -> Cow<'a, str> {
    let parsable = parsable_css(css, flags);
    let Cow::Owned(parsable) = parsable else {
        return parsable;
    };
    // Invalid CSS fails the validation with the same error
    let Ok(classes) = element_classes(&parsable, ModifierCss::Block) else {
        return Cow::Owned(parsable);
    };
    let flag_classes = flag_classes(flags);
    let mut validation = css.to_owned();
    for class in classes {
        if flag_classes.iter().any(|flag| flag.name == class.name) {
            validation.replace_range(class.start..class.end, &parsable[class.start..class.end]);
        }
    }
    Cow::Owned(validation)
}

/// The `$` style flag class starting at `start`, e.g. `$active` in `& .$active`. It is not valid
/// CSS, so it can only be used in selectors of the element, where it is replaced by the hashed class
pub(crate) fn misplaced_flag_class_at(
    css: &str,
    start: usize,
    flags: &[StyleFlag],
) -> Option<String> {
    if !css.get(..start)?.ends_with('.') {
        return None;
    }
    let rest = css.get(start..)?;
    let class_end = rest
        .find(|character: char| {
            !character.is_ascii_alphanumeric() && !matches!(character, '-' | '_' | '$')
        })
        .unwrap_or(rest.len());
    let class = &rest[..class_end];
    flag_classes(flags)
        .into_iter()
        .find(|flag| flag.original.contains('$') && flag.original == class)
        .map(|flag| flag.original)
}

/// Renames the flag classes of the element selectors to their hashed names. Fails for flag classes
/// of rules that match both the element and other elements, renaming them would break the other
/// elements
pub(crate) fn rewrite_style_flag_selectors(
    css: &str,
    classes: &[ElementClass],
    flags: &[StyleFlag],
) -> Result<String, CssError> {
    let flag_classes = flag_classes(flags);
    let mappings = flag_classes
        .iter()
        .map(|flag| (flag.name.clone(), flag.hashed.clone(), true))
        .collect::<Vec<_>>();
    rewrite_classes(css, classes, &mappings, |name| {
        let original = flag_classes
            .iter()
            .find(|flag| flag.name == name)
            .map_or(name, |flag| flag.original.as_str());
        format!(
            "style flag class \"{original}\" can't be used in a rule that matches both the element and other elements, like \"&.{original}\" nested in \"&:hover, & .child\" or \":where(&, .x)\". Split the selectors into separate rules."
        )
    })
}

/// The selectors of the flag classes not used by the element, e.g. `&.active`
pub(crate) fn missing_style_flag_selectors(
    classes: &[ElementClass],
    flags: &[StyleFlag],
) -> Vec<String> {
    flag_classes(flags)
        .into_iter()
        .filter(|flag| !classes.iter().any(|class| class.name == flag.name))
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
        if !flag_classes.iter().any(|flag| flag.name == class.name)
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
    }
}
