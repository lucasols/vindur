use oxc_css_parser::{
    Allocator,
    ast::{QualifiedRule, Statement},
};

use super::css_syntax::{BlockKind, CssError, parse_style_block};
use super::css_tokens::skipped_token_end;

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
    format!(
        "{LAYER_MARKER_PREFIX}{}{LAYER_MARKER_SUFFIX}",
        hex_encode(name)
    )
}

fn decode_layer_marker(selector: &str) -> Option<String> {
    hex_decode(
        selector
            .strip_prefix(LAYER_MARKER_PREFIX)?
            .strip_suffix(LAYER_MARKER_SUFFIX)?,
    )
}

/// Shows the layer markers in a CSS excerpt as the `layer()` calls that produced them
pub(crate) fn with_layer_calls(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(LAYER_MARKER_PREFIX) {
        output.push_str(&rest[..start]);
        let after = &rest[start + LAYER_MARKER_PREFIX.len()..];
        let decoded = after
            .find(LAYER_MARKER_SUFFIX)
            .and_then(|end| Some((end, hex_decode(&after[..end])?)));
        if let Some((end, name)) = decoded {
            output.push_str(&format!("${{layer('{name}')}}"));
            rest = &after[end + LAYER_MARKER_SUFFIX.len()..];
        } else {
            output.push_str(LAYER_MARKER_PREFIX);
            rest = after;
        }
    }
    output.push_str(rest);
    output
}

/// Encodes a name as hex so it can be embedded in a CSS identifier
pub(crate) fn hex_encode(name: &str) -> String {
    name.bytes().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) fn hex_decode(encoded: &str) -> Option<String> {
    if !encoded.len().is_multiple_of(2) {
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

pub(super) fn top_level_layer(css: &str, rule: &QualifiedRule<'_>) -> Option<String> {
    decode_layer_marker(&css[rule.selector.span.start..rule.selector.span.end])
}

fn push_plain_section<'a>(sections: &mut Vec<LayerSection<'a>>, css: &'a str) {
    let css = css.trim();
    // Like the `;` after a layer rule in `${layer('base')} { ... };`
    if !css
        .trim_matches(|character: char| character == ';' || character.is_whitespace())
        .is_empty()
    {
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
    let Some(start) = layer_marker_starts(css).find(|start| !top_level_layers.contains(start))
    else {
        return Ok(());
    };
    let in_top_level_selector = statements.iter().any(|statement| {
        matches!(statement, Statement::QualifiedRule(rule)
            if (rule.selector.span.start..rule.selector.span.end).contains(&start))
    });
    let message = match kind {
        BlockKind::Style if in_top_level_selector => {
            "layer() must be the only selector of its rule, e.g. `${layer('name')} { ... }`"
        }
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

/// The positions of the layer markers inside comments, strings and urls
pub(crate) fn layer_markers_in_text(css: &str) -> Vec<usize> {
    let visible = layer_marker_starts(css).collect::<Vec<_>>();
    css.match_indices(LAYER_MARKER_PREFIX)
        .map(|(start, _)| start)
        .filter(|start| !visible.contains(start))
        .collect()
}

/// The positions of the layer markers, text inside comments, strings and urls is ignored
fn layer_marker_starts(css: &str) -> impl Iterator<Item = usize> + '_ {
    let mut index = 0;
    std::iter::from_fn(move || {
        while let Some(character) = css[index..].chars().next() {
            let start = index;
            if let Some(end) = skipped_token_end(css, index) {
                index = end;
                continue;
            }
            if css[index..].starts_with(LAYER_MARKER_PREFIX) {
                index += LAYER_MARKER_PREFIX.len();
                return Some(start);
            }
            index += character.len_utf8();
        }
        None
    })
}

/// Collapses repeated `;` separators, comments, strings and urls are kept as is
fn collapse_double_semicolons(css: &str) -> String {
    let mut output = String::with_capacity(css.len());
    let mut previous_was_semicolon = false;
    let mut index = 0;
    while let Some(character) = css[index..].chars().next() {
        if let Some(end) = skipped_token_end(css, index) {
            output.push_str(&css[index..end]);
            previous_was_semicolon = false;
            index = end;
            continue;
        }
        index += character.len_utf8();
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
        assert_eq!(
            clean_css("/* don't */ margin: 0;; padding: 0;;"),
            "/* don't */ margin: 0; padding: 0;"
        );
        assert_eq!(
            clean_css("background: u\\72l(a;;b.png);;"),
            "background: u\\72l(a;;b.png);"
        );
        assert_eq!(
            clean_css("background: \\75 rl(a;;b.png);;"),
            "background: \\75 rl(a;;b.png);"
        );
    }

    #[test]
    fn rejects_unbalanced_layer_blocks() {
        let css = format!("{} {{ color: red; }} }}", layer_marker("theme"));
        assert!(generate_class_rules("button", &css).is_err());
    }

    #[test]
    fn ignores_layer_markers_in_strings_and_comments() {
        assert_eq!(
            rules("content: \"__VINDUR_LAYER_START__\"; /* __VINDUR_LAYER_START__ */"),
            vec![
                ".button {\n  content: \"__VINDUR_LAYER_START__\"; /* __VINDUR_LAYER_START__ */\n}"
                    .to_owned()
            ]
        );
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
