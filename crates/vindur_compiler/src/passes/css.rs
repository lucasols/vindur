use oxc_css_parser::{
    Allocator,
    ast::{QualifiedRule, Statement},
};

use super::css_syntax::{BlockKind, CssError, parse_style_block};

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
    let Some(sections) = split_layer_sections(css)? else {
        return Ok(vec![format!(".{class_name} {{\n  {css}\n}}")]);
    };
    Ok(sections
        .into_iter()
        .map(|section| {
            let rule = format!(".{class_name} {{\n  {}\n}}", section.css);
            match section.layer {
                // An empty layer still declares its position in the layer order
                Some(layer) if section.css.is_empty() => format!("@layer {layer};"),
                Some(layer) => format!("@layer {layer} {{\n  {rule}\n}}"),
                None => rule,
            }
        })
        .collect())
}

struct LayerSection<'a> {
    layer: Option<String>,
    css: &'a str,
}

/// Splits the top level `layer()` blocks from the plain declarations around them, returns `None`
/// when the CSS has no layers
fn split_layer_sections(css: &str) -> Result<Option<Vec<LayerSection<'_>>>, CssError> {
    let allocator = Allocator::default();
    let stylesheet = parse_style_block(&allocator, css)?;
    reject_misplaced_layers(css, &stylesheet.statements, BlockKind::Style)?;
    let mut sections = Vec::new();
    let mut has_layers = false;
    let mut cursor = 0;
    for statement in &stylesheet.statements {
        let Statement::QualifiedRule(rule) = statement else {
            continue;
        };
        let Some(layer) = top_level_layer(css, rule) else {
            continue;
        };
        has_layers = true;
        push_plain_section(&mut sections, &css[cursor..rule.span.start]);
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
        sections.push(LayerSection {
            layer: Some(layer),
            css: css[block_start + 1..block_end - 1].trim(),
        });
        cursor = rule.span.end;
    }
    if !has_layers {
        return Ok(None);
    }
    push_plain_section(&mut sections, &css[cursor..]);
    Ok(Some(sections))
}

fn top_level_layer(css: &str, rule: &QualifiedRule<'_>) -> Option<String> {
    decode_layer_marker(&css[rule.selector.span.start..rule.selector.span.end])
}

fn push_plain_section<'a>(sections: &mut Vec<LayerSection<'a>>, css: &'a str) {
    let css = css.trim();
    if !css.is_empty() {
        sections.push(LayerSection { layer: None, css });
    }
}

/// `layer()` can only be the selector of a top level rule in a class style block
pub(crate) fn reject_misplaced_layers(
    css: &str,
    statements: &[Statement<'_>],
    kind: BlockKind,
) -> Result<(), CssError> {
    let top_level_layers = statements
        .iter()
        .filter_map(|statement| match statement {
            Statement::QualifiedRule(rule) if kind == BlockKind::Style => {
                top_level_layer(css, rule).map(|_| rule.selector.span.start)
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    let Some((start, _)) = css
        .match_indices(LAYER_MARKER_PREFIX)
        .find(|(start, _)| !top_level_layers.contains(start))
    else {
        return Ok(());
    };
    let message = match kind {
        BlockKind::Style => "layer() can only be used at the top level of a style block",
        BlockKind::Global => {
            "layer() is not supported in createGlobalStyle, use `@layer name { ... }` instead"
        }
        BlockKind::Keyframes => "layer() is not supported in keyframes",
    };
    Err(CssError::new(
        message.to_owned(),
        start,
        start + LAYER_MARKER_PREFIX.len(),
    ))
}

/// Collapses repeated `;` separators, text inside strings is kept as is
fn collapse_double_semicolons(css: &str) -> String {
    let mut output = String::with_capacity(css.len());
    let mut previous_was_semicolon = false;
    let mut quote = None;
    let mut escaped = false;
    for character in css.chars() {
        if let Some(open_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == open_quote {
                quote = None;
            }
        } else if character == ';' {
            if previous_was_semicolon {
                continue;
            }
            previous_was_semicolon = true;
        } else if !character.is_whitespace() {
            previous_was_semicolon = false;
            if matches!(character, '"' | '\'') {
                quote = Some(character);
            }
        }
        output.push(character);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{clean_css, generate_class_rules, layer_marker};

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
    fn keeps_dotted_layer_names() {
        let css = format!("{} {{ color: red; }}", layer_marker("theme.base"));
        assert_eq!(
            rules(&css),
            vec!["@layer theme.base {\n  .button {\n  color: red;\n}\n}".to_owned()]
        );
    }

    #[test]
    fn keeps_empty_layers_in_the_layer_order() {
        let css = format!(
            "{} {{}}\n{} {{ color: blue; }}",
            layer_marker("first"),
            layer_marker("second")
        );
        assert_eq!(
            rules(&css),
            vec![
                "@layer first;".to_owned(),
                "@layer second {\n  .button {\n  color: blue;\n}\n}".to_owned(),
            ]
        );
    }

    #[test]
    fn collapses_semicolons_outside_strings() {
        assert_eq!(
            clean_css("; color: red;; content: \";;\";; quotes: '\\';;';;"),
            "color: red; content: \";;\"; quotes: '\\';;';"
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
