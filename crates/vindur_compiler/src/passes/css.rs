pub(crate) fn clean_css(css: &str) -> String {
    let trimmed = css.trim();
    let without_leading_semicolon = trimmed.strip_prefix(';').map_or(trimmed, str::trim_start);
    collapse_double_semicolons(without_leading_semicolon)
}

const LAYER_MARKER: &str = "__VINDUR_LAYER_START__";

pub(crate) fn generate_class_rules(class_name: &str, css: &str) -> Vec<String> {
    if css.is_empty() {
        return Vec::new();
    }
    let sections = split_layer_sections(css);
    if sections.is_empty() {
        return vec![format!(".{class_name} {{\n  {css}\n}}")];
    }
    sections
        .into_iter()
        .map(|section| {
            let rule = format!(".{class_name} {{\n  {}\n}}", section.css);
            section.layer.map_or_else(
                || rule.clone(),
                |layer| format!("@layer {layer} {{\n  {rule}\n}}"),
            )
        })
        .collect()
}

struct LayerSection<'a> {
    layer: Option<&'a str>,
    css: &'a str,
}

fn split_layer_sections(css: &str) -> Vec<LayerSection<'_>> {
    let mut sections = Vec::new();
    let mut cursor = 0;
    while let Some(relative_start) = css[cursor..].find(LAYER_MARKER) {
        let marker_start = cursor + relative_start;
        push_section(&mut sections, None, &css[cursor..marker_start]);
        let name_start = marker_start + LAYER_MARKER.len();
        let Some(name_end_offset) = css[name_start..].find("__") else {
            break;
        };
        let name_end = name_start + name_end_offset;
        let Some(brace_offset) = css[name_end + 2..].find('{') else {
            break;
        };
        let opening_brace = name_end + 2 + brace_offset;
        let Some(closing_brace) = matching_closing_brace(css, opening_brace) else {
            break;
        };
        push_section(
            &mut sections,
            Some(&css[name_start..name_end]),
            &css[opening_brace + 1..closing_brace],
        );
        cursor = closing_brace + 1;
    }
    if !sections.is_empty() {
        push_section(&mut sections, None, &css[cursor..]);
    }
    sections
}

fn matching_closing_brace(css: &str, opening_brace: usize) -> Option<usize> {
    let mut depth = 0_u32;
    for (offset, character) in css[opening_brace..].char_indices() {
        match character {
            '{' => depth += 1,
            '}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(opening_brace + offset);
                }
            }
            _ => {}
        }
    }
    None
}

fn push_section<'a>(sections: &mut Vec<LayerSection<'a>>, layer: Option<&'a str>, css: &'a str) {
    let css = css.trim();
    if !css.is_empty() {
        sections.push(LayerSection { layer, css });
    }
}

fn collapse_double_semicolons(css: &str) -> String {
    let mut output = String::with_capacity(css.len());
    let mut previous_was_semicolon = false;
    for character in css.chars() {
        if character == ';' {
            if previous_was_semicolon {
                continue;
            }
            previous_was_semicolon = true;
        } else if !character.is_whitespace() {
            previous_was_semicolon = false;
        }
        output.push(character);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::generate_class_rules;

    #[test]
    fn splits_layered_and_plain_sections() {
        let css = "display: block;\n__VINDUR_LAYER_START__theme__ { color: red; &:hover { color: blue; } }\nfont-weight: bold;";
        assert_eq!(
            generate_class_rules("button", css),
            vec![
                ".button {\n  display: block;\n}".to_owned(),
                "@layer theme {\n  .button {\n  color: red; &:hover { color: blue; }\n}\n}"
                    .to_owned(),
                ".button {\n  font-weight: bold;\n}".to_owned(),
            ]
        );
    }
}
