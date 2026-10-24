// Rewrites `&.name` modifier selectors to their hashed classes, matching whole
// class names only so `&.active` doesn't touch `&.activeIcon`
pub(super) fn rewrite_cx_selectors(css: &str, mappings: &[(String, String, bool)]) -> String {
    let mut output = css.to_owned();
    for (original, hashed, should_rewrite) in mappings {
        if !*should_rewrite {
            continue;
        }
        let needle = format!("&.{original}");
        let mut rewritten = String::with_capacity(output.len());
        let mut rest = output.as_str();
        while let Some(index) = rest.find(&needle) {
            let end = index + needle.len();
            rewritten.push_str(&rest[..index]);
            if continues_class_name(&rest[end..]) {
                rewritten.push_str(&needle);
            } else {
                rewritten.push_str("&.");
                rewritten.push_str(hashed);
            }
            rest = &rest[end..];
        }
        rewritten.push_str(rest);
        output = rewritten;
    }
    output
}

pub(super) fn contains_class_selector(css: &str, class_name: &str) -> bool {
    let needle = format!(".{class_name}");
    css.match_indices(&needle)
        .any(|(index, _)| !continues_class_name(&css[index + needle.len()..]))
}

fn continues_class_name(rest: &str) -> bool {
    rest.chars().next().is_some_and(|character| {
        character.is_ascii_alphanumeric()
            || character == '_'
            || character == '-'
            || !character.is_ascii()
    })
}
