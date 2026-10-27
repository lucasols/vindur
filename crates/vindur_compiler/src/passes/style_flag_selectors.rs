use std::borrow::Cow;

use super::css_syntax::CssError;
use super::cx_modifier_selectors::{ElementClass, ModifierCss, element_classes, rewrite_classes};
use super::styled::{StyleFlag, StyleFlagKind};

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
        let range = class.start..class.end;
        if flag_classes
            .iter()
            .any(|flag| css.get(range.clone()) == Some(flag.original.as_str()))
        {
            validation.replace_range(range.clone(), &parsable[range]);
        }
    }
    Cow::Owned(validation)
}

/// The `$` style flag class in the `error` range of the `validation_css`, e.g. `$active` in
/// `& .$active` or `&:has(.$active)`. It is not valid CSS, so it can only be used in selectors of
/// the element, where it is replaced by the hashed class
pub(crate) fn misplaced_flag_class_error(
    validation_css: &str,
    error: &CssError,
    flags: &[StyleFlag],
) -> Option<CssError> {
    // The error can start inside the class, e.g. at `$on` in `.is$on`
    let start = validation_css
        .get(..error.start)?
        .trim_end_matches(is_class_character)
        .len();
    let end = error.end.max(error.start + 1);
    flag_classes(flags)
        .into_iter()
        .filter(|flag| flag.original.contains('$'))
        .find_map(|flag| {
            let selector = format!(".{}", flag.original);
            let (dot, _) = validation_css.match_indices(&selector).find(|(dot, _)| {
                dot + 1 >= start
                    && *dot < end
                    && !validation_css[dot + selector.len()..].starts_with(is_class_character)
            })?;
            Some(CssError::new(
                format!(
                    "Style flag \"{0}\" can only be used in selectors of the element itself, e.g. \"&.{0}\"",
                    flag.original
                ),
                dot + 1,
                dot + selector.len(),
            ))
        })
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
