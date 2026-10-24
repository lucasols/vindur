use oxc_css_parser::{Allocator, ast::Statement};

use super::css_syntax::{CssError, parse_style_block};

pub(crate) fn clean_css(css: &str) -> String {
    let trimmed = css.trim();
    let without_leading_semicolon = trimmed.strip_prefix(';').map_or(trimmed, str::trim_start);
    collapse_double_semicolons(without_leading_semicolon)
}

const LAYER_MARKER_PREFIX: &str = "__VINDUR_LAYER_START__";
const LAYER_MARKER_SUFFIX: &str = "__";

/// `layer('name')` interpolations are replaced by a selector marker, the layer name is hex
/// encoded so the marker is always a single valid CSS identifier
pub(crate) fn layer_marker(name: &str) -> String {
    let encoded = name
        .bytes()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{LAYER_MARKER_PREFIX}{encoded}{LAYER_MARKER_SUFFIX}")
}

fn decode_layer_marker(selector: &str) -> Option<String> {
    let encoded = selector
        .strip_prefix(LAYER_MARKER_PREFIX)?
        .strip_suffix(LAYER_MARKER_SUFFIX)?;
    if encoded.len() % 2 != 0 {
        return None;
    }
    let bytes = (0..encoded.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(encoded.get(index..index + 2)?, 16).ok())
        .collect::<Option<Vec<_>>>()?;
    String::from_utf8(bytes).ok()
}

pub(crate) fn generate_class_rules(class_name: &str, css: &str) -> Result<Vec<String>, CssError> {
    if css.is_empty() {
        return Ok(Vec::new());
    }
    let sections = split_layer_sections(css)?;
    if sections.is_empty() {
        return Ok(vec![format!(".{class_name} {{\n  {css}\n}}")]);
    }
    Ok(sections
        .into_iter()
        .map(|section| {
            let rule = format!(".{class_name} {{\n  {}\n}}", section.css);
            section.layer.map_or_else(
                || rule.clone(),
                |layer| format!("@layer {layer} {{\n  {rule}\n}}"),
            )
        })
        .collect())
}

struct LayerSection<'a> {
    layer: Option<String>,
    css: &'a str,
}

/// Splits the top level `layer()` blocks from the plain declarations around them, returns no
/// sections when the CSS has no layers
fn split_layer_sections(css: &str) -> Result<Vec<LayerSection<'_>>, CssError> {
    let allocator = Allocator::default();
    let stylesheet = parse_style_block(&allocator, css)?;
    let mut sections = Vec::new();
    let mut has_layers = false;
    let mut cursor = 0;
    for statement in &stylesheet.statements {
        let Statement::QualifiedRule(rule) = statement else {
            continue;
        };
        let selector = &css[rule.selector.span.start..rule.selector.span.end];
        let Some(layer) = decode_layer_marker(selector) else {
            continue;
        };
        has_layers = true;
        push_section(&mut sections, None, css, cursor, rule.span.start)?;
        let (block_start, block_end) = (rule.block.span.start, rule.block.span.end);
        if !css[block_start..block_end].starts_with('{')
            || !css[block_start..block_end].ends_with('}')
        {
            return Err(CssError::new(
                "Internal compiler error: unexpected layer block shape".to_owned(),
                block_start,
                block_end,
            ));
        }
        push_section(
            &mut sections,
            Some(layer),
            css,
            block_start + 1,
            block_end - 1,
        )?;
        cursor = rule.span.end;
    }
    if !has_layers {
        reject_nested_layers(css, 0, css.len())?;
        return Ok(Vec::new());
    }
    push_section(&mut sections, None, css, cursor, css.len())?;
    Ok(sections)
}

fn push_section<'a>(
    sections: &mut Vec<LayerSection<'a>>,
    layer: Option<String>,
    css: &'a str,
    start: usize,
    end: usize,
) -> Result<(), CssError> {
    reject_nested_layers(css, start, end)?;
    let section = css[start..end].trim();
    if !section.is_empty() {
        sections.push(LayerSection {
            layer,
            css: section,
        });
    }
    Ok(())
}

fn reject_nested_layers(css: &str, start: usize, end: usize) -> Result<(), CssError> {
    if css[start..end].contains(LAYER_MARKER_PREFIX) {
        return Err(CssError::new(
            "layer() can only be used at the top level of a style block".to_owned(),
            start,
            end,
        ));
    }
    Ok(())
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
    use super::{generate_class_rules, layer_marker};

    fn rules(css: &str) -> Vec<String> {
        match generate_class_rules("button", css) {
            Ok(rules) => rules,
            Err(error) => panic!("{}", error.message),
        }
    }

    #[test]
    fn splits_layered_and_plain_sections() {
        let css = format!(
            "display: block;\n{} {{ color: red; &:hover {{ color: blue; }} }}\nfont-weight: bold;",
            layer_marker("theme")
        );
        assert_eq!(
            rules(&css),
            vec![
                ".button {\n  display: block;\n}".to_owned(),
                "@layer theme {\n  .button {\n  color: red; &:hover { color: blue; }\n}\n}"
                    .to_owned(),
                ".button {\n  font-weight: bold;\n}".to_owned(),
            ]
        );
    }

    #[test]
    fn ignores_braces_inside_strings() {
        let css = format!(
            "{} {{ content: \"}}\"; color: red; }}\nfont-weight: bold;",
            layer_marker("theme")
        );
        assert_eq!(
            rules(&css),
            vec![
                "@layer theme {\n  .button {\n  content: \"}\"; color: red;\n}\n}".to_owned(),
                ".button {\n  font-weight: bold;\n}".to_owned(),
            ]
        );
    }

    #[test]
    fn keeps_any_layer_name() {
        let css = format!("{} {{ color: red; }}", layer_marker("invalid layer name"));
        assert_eq!(
            rules(&css),
            vec!["@layer invalid layer name {\n  .button {\n  color: red;\n}\n}".to_owned()]
        );
    }

    #[test]
    fn rejects_unbalanced_layer_blocks() {
        let css = format!("{} {{ color: red; }} }}", layer_marker("theme"));
        assert!(generate_class_rules("button", &css).is_err());
    }

    #[test]
    fn rejects_nested_layers() {
        let css = format!("&:hover {{ {} {{ color: red; }} }}", layer_marker("theme"));
        match generate_class_rules("button", &css) {
            Ok(rules) => panic!("expected an error, got {rules:?}"),
            Err(error) => assert_eq!(
                error.message,
                "layer() can only be used at the top level of a style block"
            ),
        }
    }
}
