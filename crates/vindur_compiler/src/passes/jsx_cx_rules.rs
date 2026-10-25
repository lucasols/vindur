/// Rewrites the cx modifiers of the css rule of `class_name` to their hashed names
pub(super) fn rewrite_class_rule(
    css_rules: &mut [String],
    class_name: &str,
    mappings: &[(String, String, bool)],
) {
    let rule_start = format!(".{class_name} {{");
    for rule in css_rules
        .iter_mut()
        .filter(|rule| rule.starts_with(&rule_start))
    {
        for (original, hashed, should_rewrite) in mappings {
            if *should_rewrite {
                *rule = rule.replace(&format!("&.{original}"), &format!("&.{hashed}"));
            }
        }
    }
}

/// The hashed cx keys used as `&.key` modifiers in the css rule of `class_name`
pub(super) fn declared_modifiers<'a>(
    css_rules: &[String],
    class_name: &str,
    mappings: &'a [(String, String, bool)],
) -> Vec<&'a str> {
    let rule_start = format!(".{class_name} {{");
    let rules = css_rules
        .iter()
        .filter(|rule| rule.starts_with(&rule_start))
        .collect::<Vec<_>>();
    mappings
        .iter()
        .filter(|(original, _, should_rewrite)| {
            *should_rewrite && rules.iter().any(|rule| declares_modifier(rule, original))
        })
        .map(|(original, _, _)| original.as_str())
        .collect()
}

fn declares_modifier(rule: &str, class_name: &str) -> bool {
    let selector = format!("&.{class_name}");
    rule.match_indices(&selector).any(|(index, _)| {
        !rule[index + selector.len()..]
            .chars()
            .next()
            .is_some_and(|next| next.is_ascii_alphanumeric() || next == '_' || next == '-')
    })
}
