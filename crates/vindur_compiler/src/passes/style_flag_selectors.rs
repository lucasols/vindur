use std::{borrow::Cow, ops::Range};

use oxc_css_parser::Allocator;
use rustc_hash::FxHashMap;

use super::css_syntax::{CssError, parse_style_block};
use super::cx_modifier_selectors::{
    ElementClass, ModifierCss, element_classes, referenced_classes, rewrite_classes,
    style_block_classes,
};
use super::styled::{StyleFlag, StyleFlagKind, StyledComponent};
use super::styled_jsx_helpers::is_class_rule;

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
    Cow::Owned(dollar_classes_as_underscores(css))
}

fn dollar_classes_as_underscores(css: &str) -> String {
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
    parsable
}

/// The range of the first `$` class selected through a reference to a styled component, e.g.
/// `$active` in `${Item}.$active &`. `$` flag classes are not valid CSS, so they can't be selected
/// through a reference, only in selectors of the element itself
pub(crate) fn referenced_dollar_class(
    css: &str,
    classes: &[String],
    placeholders: &[String],
) -> Option<Range<usize>> {
    let parsable = dollar_classes_as_underscores(css);
    let allocator = Allocator::default();
    let stylesheet = parse_style_block(&allocator, &parsable).ok()?;
    referenced_classes(&stylesheet.statements, classes, placeholders)
        .into_iter()
        .map(|class| class.start..class.end)
        .find(|range| {
            css.get(range.clone())
                .is_some_and(|name| name.contains('$'))
        })
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
            .find(|flag| flag.original == unescape_class(written))
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

/// The class name a CSS identifier stands for, e.g. `$active` for `\$active` or `\24 active`
fn unescape_class(written: &str) -> Cow<'_, str> {
    if !written.contains('\\') {
        return Cow::Borrowed(written);
    }
    let mut name = String::with_capacity(written.len());
    let mut characters = written.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '\\' {
            name.push(character);
            continue;
        }
        let mut code_point = String::new();
        while code_point.len() < 6
            && let Some(digit) = characters.next_if(char::is_ascii_hexdigit)
        {
            code_point.push(digit);
        }
        if code_point.is_empty() {
            name.extend(characters.next());
            continue;
        }
        // A whitespace ends a hex escape, e.g. `\24 active`
        characters.next_if(|character| character.is_ascii_whitespace());
        name.push(
            u32::from_str_radix(&code_point, 16)
                .ok()
                .and_then(char::from_u32)
                .unwrap_or(char::REPLACEMENT_CHARACTER),
        );
    }
    Cow::Owned(name)
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
    components: &FxHashMap<String, StyledComponent>,
) -> Result<(), ReferencedFlagError> {
    let references = components
        .iter()
        .filter(|(_, component)| !component.style_flags.is_empty())
        .filter_map(|(name, component)| {
            let class_name = component.class_name.split_whitespace().last()?;
            Some((
                name.as_str(),
                class_name.to_owned(),
                flag_classes(&component.style_flags),
            ))
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
        .filter(|(index, _)| !rule[index + selector.len()..].starts_with(is_class_character))
        .count();
    selections > usize::from(is_class_rule(rule, class_name))
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
    use super::{StyleFlag, StyleFlagKind, parsable_css, references_class, unescape_class};

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

    #[test]
    fn unescapes_class_names() {
        assert_eq!(
            [
                unescape_class("$active"),
                unescape_class("\\$active"),
                unescape_class("\\24 active"),
                unescape_class("\\000024active"),
            ],
            ["$active"; 4]
        );
    }

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
