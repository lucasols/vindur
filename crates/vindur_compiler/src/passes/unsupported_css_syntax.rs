use oxc_span::Span;

use super::css_tokens::{
    block_end, decode_ident, ident_end, is_ident_char, skipped_token_end, unprefixed_at_rule_name,
};
use super::template_location::{SegmentOrigin, TemplateSegment, template_source_span};
use crate::CompilerDiagnostic;

const GLOBAL_SELECTOR: &str = ":global";
// At-rules browsers only accept at the top level of a stylesheet or in grouping rules, they are
// dropped inside style rules
const TOP_LEVEL_AT_RULES: [&str; 13] = [
    "keyframes",
    "font-face",
    "import",
    "property",
    "charset",
    "namespace",
    "counter-style",
    "font-palette-values",
    "font-feature-values",
    "page",
    "position-try",
    "view-transition",
    "color-profile",
];
const STYLESHEET_START_AT_RULES: [&str; 3] = ["import", "charset", "namespace"];
// At-rules whose blocks can contain other rules like `@keyframes`. `@scope` is not included, its
// rules are scoped style rules, where browsers drop stylesheet at-rules
const GROUPING_AT_RULES: [&str; 6] = [
    "media",
    "supports",
    "layer",
    "container",
    "document",
    "starting-style",
];

struct UnsupportedSyntax {
    offset: usize,
    len: usize,
    message: String,
}

#[derive(Clone, Copy)]
enum Block<'a> {
    Grouping,
    Style { pseudo_element: bool },
    OtherAtRule(&'a str),
}

// Syntax that vindur doesn't process would be emitted as invalid CSS that the
// browser silently drops, so it fails the transform instead. The evaluated CSS
// is checked as a whole so comments, strings and selectors split by
// interpolations are handled like the browser would see them
pub(super) fn unsupported_syntax_error(
    css: &str,
    segments: &[TemplateSegment],
    template_span: Span,
    tag_type: &str,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let syntax = find_unsupported_syntax(css, tag_type)?;
    let Some((span, start_segment)) = template_source_span(
        css,
        source,
        segments,
        syntax.offset..syntax.offset + syntax.len,
    ) else {
        return Some(CompilerDiagnostic::error(
            file_path,
            source,
            template_span,
            syntax.message,
        ));
    };
    let message = match start_segment.origin {
        SegmentOrigin::Interpolation(_) => {
            format!("{} (found in the interpolated value)", syntax.message)
        }
        SegmentOrigin::Quasi(_) => syntax.message,
    };
    Some(CompilerDiagnostic::error(file_path, source, span, message))
}

fn find_unsupported_syntax(css: &str, tag_type: &str) -> Option<UnsupportedSyntax> {
    let bytes = css.as_bytes();
    let mut blocks: Vec<Block<'_>> = Vec::new();
    let mut prelude_start: Option<usize> = None;
    let mut paren_depth = 0_usize;
    let mut index = 0;
    while index < bytes.len() {
        // A statement can start with an escape, like the custom property `\2d -x: value`
        if bytes[index] == b'\\' && prelude_start.is_none() {
            prelude_start = Some(index);
        }
        if let Some(end) = skipped_token_end(css, index) {
            index = end;
            continue;
        }
        let rest = &css[index..];
        let byte = bytes[index];
        if is_global_selector(rest)
            && !is_custom_property_value(css, prelude_start)
            && !is_at_rule_prelude(css, prelude_start)
            && starts_rule_block(css, index)
        {
            return Some(UnsupportedSyntax {
                offset: index,
                len: GLOBAL_SELECTOR.len(),
                message: global_selector_message(rest, tag_type).to_owned(),
            });
        }
        if byte == b'&'
            && let Some(suffix_len) = selector_suffix_len(rest)
            && !is_custom_property_value(css, prelude_start)
            && !is_at_rule_prelude(css, prelude_start)
            && starts_rule_block(css, index)
        {
            return Some(UnsupportedSyntax {
                offset: index,
                len: suffix_len,
                message: selector_suffix_message(&rest[..suffix_len], tag_type, &blocks),
            });
        }
        // At-rules only start a statement, otherwise `@keyframes` is part of a
        // declaration value like `--x: @keyframes;`
        if byte == b'@'
            && prelude_start.is_none()
            && let Some((at_rule, name)) = at_rule_name(rest)
            && TOP_LEVEL_AT_RULES.contains(&name.as_str())
        {
            // `@import`, `@charset` and `@namespace` are only valid before every rule
            let enclosing_block = blocks.iter().rev().find(|block| {
                !matches!(block, Block::Grouping)
                    || STYLESHEET_START_AT_RULES.contains(&name.as_str())
            });
            if tag_type != "createGlobalStyle" || enclosing_block.is_some() {
                return Some(UnsupportedSyntax {
                    offset: index,
                    len: at_rule.len(),
                    message: top_level_at_rule_message(at_rule, &name, tag_type, enclosing_block),
                });
            }
        }
        match byte {
            b'(' | b'[' => paren_depth += 1,
            b')' | b']' => paren_depth = paren_depth.saturating_sub(1),
            // Braces and semicolons inside parentheses are part of the prelude or
            // value, e.g. `@supports (--x: {a:b})`
            _ if paren_depth > 0 => {}
            // Braces in custom property values are part of the value, so the whole balanced
            // block is skipped, e.g. `--x: { @keyframes y {} };`
            b'{' if is_custom_property_value(css, prelude_start) => {
                index = block_end(css, index).unwrap_or(css.len());
                continue;
            }
            b'{' => {
                let block = block_kind(css, prelude_start);
                if let (Block::Style { .. }, Some(start)) = (block, prelude_start)
                    && is_in_pseudo_element_rule(&blocks)
                {
                    let selector = css[start..index].trim_end();
                    return Some(UnsupportedSyntax {
                        offset: start,
                        len: selector.len(),
                        message: pseudo_element_nesting_message(selector),
                    });
                }
                blocks.push(block);
                prelude_start = None;
            }
            b'}' => {
                blocks.pop();
                prelude_start = None;
            }
            b';' => prelude_start = None,
            byte if !byte.is_ascii_whitespace() && prelude_start.is_none() => {
                prelude_start = Some(index);
            }
            _ => {}
        }
        index += rest.chars().next().map_or(1, char::len_utf8);
    }
    None
}

// Sass and stylis concatenate `&--x`, `&__x` and `&-x` to the parent selector,
// but native CSS nesting reads the suffix as an element selector, so the rule
// never matches
fn selector_suffix_len(from_ampersand: &str) -> Option<usize> {
    let suffix = &from_ampersand[1..];
    let len = suffix
        .find(|character: char| !is_ident_char(character))
        .unwrap_or(suffix.len());
    (len > 0).then_some(len + 1)
}

// Pseudo-class names are case-insensitive
fn is_global_selector(rest: &str) -> bool {
    rest.get(..GLOBAL_SELECTOR.len())
        .is_some_and(|name| name.eq_ignore_ascii_case(GLOBAL_SELECTOR))
        && !rest[GLOBAL_SELECTOR.len()..]
            .chars()
            .next()
            .is_some_and(is_ident_char)
}

// `:global` is only a selector when its statement opens a block, otherwise it
// is part of a declaration value like `animation-name:global;`
fn starts_rule_block(css: &str, start: usize) -> bool {
    let bytes = css.as_bytes();
    let mut paren_depth = 0_usize;
    let mut index = start;
    while index < bytes.len() {
        if let Some(end) = skipped_token_end(css, index) {
            index = end;
            continue;
        }
        match bytes[index] {
            b'(' | b'[' => paren_depth += 1,
            b')' | b']' => paren_depth = paren_depth.saturating_sub(1),
            _ if paren_depth > 0 => {}
            b'{' => return true,
            b';' | b'}' => return false,
            _ => {}
        }
        index += css[index..].chars().next().map_or(1, char::len_utf8);
    }
    false
}

// Custom property values can contain any tokens, including braces, e.g.
// `--tokens: :global { a: b };`. The name can be escaped, like `\2d -tokens`
fn is_custom_property_value(css: &str, prelude_start: Option<usize>) -> bool {
    prelude_start.is_some_and(|start| {
        css[start..].starts_with("--")
            || (css[start..].starts_with('\\')
                && decode_ident(&css[start..ident_end(css, start)]).starts_with("--"))
    })
}

fn prelude_at_rule(css: &str, prelude_start: Option<usize>) -> Option<(&str, String)> {
    prelude_start
        .filter(|start| css.as_bytes()[*start] == b'@')
        .and_then(|start| at_rule_name(&css[start..]))
}

// At-rule preludes don't contain selectors, e.g. `@supports (--x:global)`,
// except for `@scope`
fn is_at_rule_prelude(css: &str, prelude_start: Option<usize>) -> bool {
    prelude_at_rule(css, prelude_start).is_some_and(|(_, name)| name != "scope")
}

fn block_kind(css: &str, prelude_start: Option<usize>) -> Block<'_> {
    let Some((at_rule, name)) = prelude_at_rule(css, prelude_start) else {
        return Block::Style {
            pseudo_element: prelude_start.is_some_and(|start| has_pseudo_element(&css[start..])),
        };
    };
    if GROUPING_AT_RULES.contains(&name.as_str()) {
        Block::Grouping
    } else {
        Block::OtherAtRule(at_rule)
    }
}

// `&` can't represent pseudo-elements, so a rule nested in `&::placeholder` becomes
// `.dark :is(.x::placeholder)` in native nesting and lightningcss, which matches nothing
fn is_in_pseudo_element_rule(blocks: &[Block<'_>]) -> bool {
    blocks.iter().any(|block| {
        matches!(
            block,
            Block::Style {
                pseudo_element: true
            }
        )
    })
}

// Legacy pseudo-elements that also accept the single colon syntax
const LEGACY_PSEUDO_ELEMENTS: [&str; 4] = ["before", "after", "first-line", "first-letter"];

// Scans the selector until its block opens
fn has_pseudo_element(css: &str) -> bool {
    let bytes = css.as_bytes();
    let mut bracket_depth = 0_usize;
    let mut index = 0;
    while index < bytes.len() {
        if let Some(token_end) = skipped_token_end(css, index) {
            index = token_end;
            continue;
        }
        match bytes[index] {
            b'{' if bracket_depth == 0 => return false,
            // Attribute selectors can contain colons, e.g. `[href^=http:]`
            b'[' => bracket_depth += 1,
            b']' => bracket_depth = bracket_depth.saturating_sub(1),
            b':' if bracket_depth == 0 => {
                if bytes.get(index + 1) == Some(&b':') {
                    return true;
                }
                let name_end = ident_end(css, index + 1);
                let name = decode_ident(&css[index + 1..name_end]).to_ascii_lowercase();
                if LEGACY_PSEUDO_ELEMENTS.contains(&name.as_str()) {
                    return true;
                }
            }
            _ => {}
        }
        index += css[index..].chars().next().map_or(1, char::len_utf8);
    }
    false
}

fn pseudo_element_nesting_message(selector: &str) -> String {
    format!(
        "`{selector}` can't be nested in a pseudo-element rule, it matches nothing since `&` can't represent pseudo-elements. Move it out and end its selector with the pseudo-element, e.g. `&::placeholder {{ .dark & {{}} }}` -> `.dark &::placeholder {{}}`"
    )
}

// Returns the at-rule and its lowercase name without vendor prefix, e.g.
// `@-webkit-Keyframes` -> `keyframes`, at-rule names are case-insensitive
fn at_rule_name(rest: &str) -> Option<(&str, String)> {
    let at_rule = &rest[..ident_end(rest, 1)];
    // The name can be escaped, like `@\6d edia`
    Some((
        at_rule,
        unprefixed_at_rule_name(&decode_ident(&at_rule[1..]))?,
    ))
}

fn top_level_at_rule_message(
    at_rule: &str,
    name: &str,
    tag_type: &str,
    enclosing_block: Option<&Block<'_>>,
) -> String {
    let at_rule = at_rule.trim_end();
    match (tag_type, enclosing_block) {
        ("createGlobalStyle", Some(Block::Grouping)) => format!(
            "`{at_rule}` must come before every rule, move it to the top level of `createGlobalStyle`"
        ),
        ("createGlobalStyle", Some(Block::OtherAtRule(enclosing_at_rule))) => format!(
            "`{at_rule}` is not supported inside `{enclosing_at_rule}` rules, move it to the top level of `createGlobalStyle`"
        ),
        ("createGlobalStyle", _) => format!(
            "`{at_rule}` is not supported inside style rules, move it to the top level of `createGlobalStyle`"
        ),
        ("keyframes", _) if name == "keyframes" => format!(
            "`{at_rule}` is not supported inside `keyframes` templates, they already generate the `@keyframes` rule so write only the frames, e.g. `from {{ ... }} to {{ ... }}`"
        ),
        _ if name != "keyframes" => format!(
            "`{at_rule}` is not supported inside `{tag_type}` templates, move it to the top level of `createGlobalStyle`"
        ),
        _ => format!(
            "`{at_rule}` is not supported inside `{tag_type}` templates, use the `keyframes` function instead"
        ),
    }
}

// At the root of a scoped template `&` is the generated class name, which
// can't be written out, so the suffix has to become a separate class
fn selector_suffix_message(selector: &str, tag_type: &str, blocks: &[Block<'_>]) -> String {
    if !selector[1..].starts_with(['-', '_']) {
        let element = &selector[1..];
        return format!(
            "`{selector}` is ambiguous, Sass concatenates it to the parent selector but CSS nesting reads it as an element selector, write `{element}&` to match `{element}` elements or the full selector for a suffix"
        );
    }
    let in_style_rule = blocks
        .iter()
        .any(|block| matches!(block, Block::Style { .. }));
    if !in_style_rule && tag_type != "createGlobalStyle" {
        return format!(
            "`{selector}` is not supported, CSS nesting can't concatenate a suffix to the generated class name, use a separate class instead, e.g. `&-active {{}}` -> `&.active {{}}`"
        );
    }
    format!(
        "`{selector}` is not supported, CSS nesting can't concatenate a suffix to the parent selector, write the full selector in its own rule instead, e.g. `.day {{ &--today {{}} }}` -> `.day--today {{}}`"
    )
}

// The suggested fix depends on which `:global` form was used and whether the
// styles are meant to escape the component scope
fn global_selector_message(from_global: &str, tag_type: &str) -> &'static str {
    let is_block = from_global[GLOBAL_SELECTOR.len()..]
        .trim_start()
        .starts_with('{');
    if tag_type == "createGlobalStyle" {
        return if is_block {
            "`:global` blocks are not supported, `createGlobalStyle` styles are already global so move the nested rules out of the block"
        } else {
            "`:global` is not supported, `createGlobalStyle` styles are already global so remove the wrapper, e.g. `:global(body)` -> `body`"
        };
    }
    if is_block {
        return "`:global` blocks are not supported, plain class selectors are not hashed so move the nested rules out of the block, e.g. `:global { .ant-btn {} }` -> `.ant-btn {}`";
    }
    let selector_end = from_global.find(['{', ';']).unwrap_or(from_global.len());
    if from_global[..selector_end].contains('&') {
        "`:global` is not supported, plain class selectors are not hashed so remove the wrapper, e.g. `:global(.dark) &` -> `.dark &`"
    } else {
        "`:global` is not supported, use `createGlobalStyle` for styles that should apply outside this component, or remove the wrapper to scope them to it, e.g. `:global(.ant-btn)` -> `.ant-btn`"
    }
}

#[cfg(test)]
mod tests {
    use super::{find_unsupported_syntax, has_pseudo_element};

    #[test]
    fn handles_non_ascii_characters_after_global() {
        assert_eq!(
            find_unsupported_syntax(":global(.café) & { color: red; }", "css")
                .map(|syntax| syntax.offset),
            Some(0)
        );
        assert!(find_unsupported_syntax("font-family:global,微软雅黑;", "css").is_none());
    }

    #[test]
    fn ignores_braces_in_custom_property_values() {
        assert!(find_unsupported_syntax("--tokens: :global { color:red };", "css").is_none());
        assert!(find_unsupported_syntax("--tokens: { :global { color:red; } };", "css").is_none());
        assert!(find_unsupported_syntax("--x: { @keyframes y {} };", "css").is_none());
        assert!(find_unsupported_syntax("\\2d -tokens: :global { a: b };", "css").is_none());
        let css = "--x: { a: b }; :global(.a) & {}";
        assert_eq!(
            find_unsupported_syntax(css, "css").map(|syntax| syntax.offset),
            css.find(":global")
        );
    }

    #[test]
    fn ignores_global_in_at_rule_preludes() {
        assert!(
            find_unsupported_syntax("@supports (--mode:global) { color: red; }", "css").is_none()
        );
        assert!(
            find_unsupported_syntax("@container style(--scope:global) { color: red; }", "css")
                .is_none()
        );
        assert_eq!(
            find_unsupported_syntax("@scope (:global(.a)) { color: red; }", "css")
                .map(|syntax| syntax.offset),
            Some(8)
        );
    }

    #[test]
    fn allows_keyframes_in_starting_style() {
        assert!(
            find_unsupported_syntax(
                "@starting-style { @keyframes fade { from { opacity: 0 } } }",
                "createGlobalStyle"
            )
            .is_none()
        );
    }

    #[test]
    fn rejects_top_level_at_rules_in_style_rules() {
        let offset = |css: &str, tag_type: &str| {
            find_unsupported_syntax(css, tag_type).map(|syntax| (syntax.offset, syntax.message))
        };
        assert_eq!(
            offset("@font-face { font-family: x; }", "css"),
            Some((
                0,
                "`@font-face` is not supported inside `css` templates, move it to the top level of `createGlobalStyle`".to_owned()
            ))
        );
        assert_eq!(
            offset("body { @import \"x.css\"; }", "createGlobalStyle").map(|(offset, _)| offset),
            Some(7)
        );
        assert!(
            offset(
                "@font-face { font-family: x; } @media print { @font-face { font-family: y; } }",
                "createGlobalStyle"
            )
            .is_none()
        );
        assert!(
            offset(
                "@\\6d edia print { @keyframes a { from { opacity: 0; } } }",
                "createGlobalStyle"
            )
            .is_none()
        );
    }

    #[test]
    fn detects_pseudo_elements_in_selectors() {
        assert!(has_pseudo_element("&::placeholder {"));
        assert!(has_pseudo_element("&:hover, &:BEFORE {"));
        assert!(has_pseudo_element("&:first-letter{"));
        assert!(!has_pseudo_element("&:hover, &:first-child {"));
        assert!(!has_pseudo_element("a[href^='x::y'], a[title=x\\:\\:y] {"));
        assert!(!has_pseudo_element("&:not(.x) { &::before {} }"));
    }

    #[test]
    fn rejects_rules_nested_in_pseudo_element_rules() {
        let offset = |css: &str| find_unsupported_syntax(css, "css").map(|syntax| syntax.offset);
        assert_eq!(offset("&::before { .dm & { color: red; } }"), Some(12));
        assert_eq!(offset("&::before { --x: { a: b }; color: red; }"), None);
        assert_eq!(offset("&::after { @media print { color: red; } }"), None);
        assert_eq!(offset("&:hover { &::after { color: red; } }"), None);
    }

    #[test]
    fn tracks_parentheses_of_quoted_urls() {
        assert!(
            find_unsupported_syntax(
                "@supports (--x: url(\"x\") {a:b}) { @keyframes fade { from {opacity:0;} } }",
                "createGlobalStyle"
            )
            .is_none()
        );
    }

    #[test]
    fn skips_escaped_parentheses_in_unquoted_urls() {
        assert!(
            find_unsupported_syntax("background:url(/img/icon\\):global.png);", "css").is_none()
        );
        let css = "background:url(/img/icon\\)); :global(.a) {}";
        assert_eq!(
            find_unsupported_syntax(css, "css").map(|syntax| syntax.offset),
            css.find(":global")
        );
    }
}
