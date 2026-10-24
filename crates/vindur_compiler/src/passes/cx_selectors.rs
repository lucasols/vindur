// Rewrites the classes of compound selectors attached to `&`, like
// `&.active.selected` or `&:hover.active`, to their hashed classes. Whole class names are matched,
// so `&.active` doesn't touch `&.activeIcon`
pub(super) fn rewrite_cx_selectors(css: &str, mappings: &[(String, String, bool)]) -> String {
    let mut output = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(index) = rest.find('&') {
        output.push_str(&rest[..=index]);
        rest = &rest[index + 1..];
        // `.class` and argument-less `:pseudo` tokens of the same compound selector
        while let Some(marker) = rest
            .chars()
            .next()
            .filter(|marker| matches!(marker, '.' | ':'))
        {
            let name = &rest[1..];
            let length = name
                .char_indices()
                .find(|(_, character)| !is_class_name_character(*character))
                .map_or(name.len(), |(index, _)| index);
            let token = &name[..length];
            let replacement = if marker == '.' {
                mappings
                    .iter()
                    .find(|(original, _, should_rewrite)| *should_rewrite && original == token)
                    .map_or(token, |(_, hashed, _)| hashed.as_str())
            } else {
                token
            };
            output.push(marker);
            output.push_str(replacement);
            rest = &name[length..];
        }
    }
    output.push_str(rest);
    output
}

pub(super) fn contains_class_selector(css: &str, class_name: &str) -> bool {
    let needle = format!(".{class_name}");
    css.match_indices(&needle)
        .any(|(index, _)| !continues_class_name(&css[index + needle.len()..]))
}

fn continues_class_name(rest: &str) -> bool {
    rest.chars().next().is_some_and(is_class_name_character)
}

fn is_class_name_character(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || character == '_'
        || character == '-'
        || !character.is_ascii()
}
