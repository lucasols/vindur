use std::ops::Range;

use oxc_span::Span;

use crate::CompilerDiagnostic;

const GLOBAL_SELECTOR: &str = ":global";
const KEYFRAMES_AT_RULE: &str = "keyframes";
// At-rules whose blocks can contain other rules like `@keyframes`
const GROUPING_AT_RULES: [&str; 7] = [
    "media",
    "supports",
    "layer",
    "container",
    "document",
    "scope",
    "starting-style",
];

pub(super) enum SegmentOrigin {
    Quasi(Span),
    Interpolation(Span),
}

// Maps a range of the evaluated template CSS back to the code that produced it
pub(super) struct TemplateSegment {
    pub range: Range<usize>,
    pub origin: SegmentOrigin,
}

struct UnsupportedSyntax {
    offset: usize,
    len: usize,
    message: String,
}

#[derive(Clone, Copy)]
enum Block<'a> {
    Grouping,
    Style,
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
    let end = syntax.offset + syntax.len;
    let segment_at = |offset: usize| {
        segments
            .iter()
            .find(|segment| segment.range.contains(&offset))
    };
    let (Some(start_segment), Some(end_segment)) = (segment_at(syntax.offset), segment_at(end - 1))
    else {
        return Some(CompilerDiagnostic::error(
            file_path,
            source,
            template_span,
            syntax.message,
        ));
    };
    let first = segment_source_span(
        css,
        source,
        start_segment,
        syntax.offset..end.min(start_segment.range.end),
    );
    let span = if std::ptr::eq(start_segment, end_segment) {
        first
    } else {
        let last = segment_source_span(css, source, end_segment, end_segment.range.start..end);
        Span::new(first.start, last.end)
    };
    let message = match start_segment.origin {
        SegmentOrigin::Interpolation(_) => {
            format!("{} (found in the interpolated value)", syntax.message)
        }
        SegmentOrigin::Quasi(_) => syntax.message,
    };
    Some(CompilerDiagnostic::error(file_path, source, span, message))
}

// The evaluated quasi text can differ from the source (escapes are cooked and
// CRLF is normalized), so the matched text is looked up in the original source,
// falling back to the whole quasi when it can't be found there or escapes make
// the occurrence ambiguous
fn segment_source_span(
    css: &str,
    source: &str,
    segment: &TemplateSegment,
    range: Range<usize>,
) -> Span {
    let span = match segment.origin {
        SegmentOrigin::Quasi(span) => span,
        SegmentOrigin::Interpolation(span) => return span,
    };
    let evaluated = &css[segment.range.clone()];
    let local = range.start - segment.range.start..range.end - segment.range.start;
    let raw_start = source
        .get(span.start as usize..span.end as usize)
        .and_then(|raw| {
            if evaluated == raw {
                return Some(local.start);
            }
            let matched = &evaluated[local.clone()];
            if evaluated.matches(matched).count() != raw.matches(matched).count() {
                return None;
            }
            let occurrence = evaluated[..local.start].matches(matched).count();
            raw.match_indices(matched)
                .nth(occurrence)
                .map(|(index, _)| index)
        })
        .and_then(|raw_start| u32::try_from(raw_start).ok());
    let len = u32::try_from(local.len()).ok();
    match (raw_start, len) {
        (Some(raw_start), Some(len)) => {
            Span::new(span.start + raw_start, span.start + raw_start + len)
        }
        _ => span,
    }
}

fn find_unsupported_syntax(css: &str, tag_type: &str) -> Option<UnsupportedSyntax> {
    let bytes = css.as_bytes();
    let mut blocks: Vec<Block<'_>> = Vec::new();
    let mut prelude_start: Option<usize> = None;
    let mut paren_depth = 0_usize;
    let mut index = 0;
    while index < bytes.len() {
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
        // At-rules only start a statement, otherwise `@keyframes` is part of a
        // declaration value like `--x: @keyframes;`
        if byte == b'@'
            && prelude_start.is_none()
            && let Some((at_rule, name)) = at_rule_name(rest)
            && name == KEYFRAMES_AT_RULE
        {
            let enclosing_block = blocks
                .iter()
                .rev()
                .find(|block| !matches!(block, Block::Grouping));
            if tag_type != "createGlobalStyle" || enclosing_block.is_some() {
                return Some(UnsupportedSyntax {
                    offset: index,
                    len: at_rule.len(),
                    message: keyframes_message(at_rule, tag_type, enclosing_block),
                });
            }
        }
        match byte {
            b'(' | b'[' => paren_depth += 1,
            b')' | b']' => paren_depth = paren_depth.saturating_sub(1),
            // Braces and semicolons inside parentheses are part of the prelude or
            // value, e.g. `@supports (--x: {a:b})`
            _ if paren_depth > 0 => {}
            b'{' if is_custom_property_value(css, prelude_start) => {
                index = custom_property_block_end(css, index);
                continue;
            }
            b'{' => {
                blocks.push(block_kind(css, prelude_start));
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

// Comments, strings, escapes and unquoted urls can't contain unsupported syntax
fn skipped_token_end(css: &str, index: usize) -> Option<usize> {
    let rest = &css[index..];
    if let Some(comment) = rest.strip_prefix("/*") {
        return Some(
            comment
                .find("*/")
                .map_or(css.len(), |end| index + 2 + end + 2),
        );
    }
    match rest.as_bytes().first() {
        Some(b'"' | b'\'') => Some(string_end(css, index)),
        Some(b'\\') => Some(escape_end(css, index)),
        _ if is_url_function(css, index) => Some(url_end(css, index)),
        _ => None,
    }
}

fn escape_end(css: &str, start: usize) -> usize {
    start + 1 + css[start + 1..].chars().next().map_or(0, char::len_utf8)
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
// `--tokens: :global { a: b };`
fn is_custom_property_value(css: &str, prelude_start: Option<usize>) -> bool {
    prelude_start.is_some_and(|start| css[start..].starts_with("--"))
}

// Braces in custom property values are part of the value, so the whole
// balanced block is skipped, e.g. `--x: { @keyframes y {} };`
fn custom_property_block_end(css: &str, start: usize) -> usize {
    let bytes = css.as_bytes();
    let mut depth = 0_usize;
    let mut index = start;
    while index < bytes.len() {
        if let Some(end) = skipped_token_end(css, index) {
            index = end;
            continue;
        }
        match bytes[index] {
            b'{' => depth += 1,
            b'}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return index + 1;
                }
            }
            _ => {}
        }
        index += css[index..].chars().next().map_or(1, char::len_utf8);
    }
    css.len()
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
        return Block::Style;
    };
    if GROUPING_AT_RULES.contains(&name.as_str()) {
        Block::Grouping
    } else {
        Block::OtherAtRule(at_rule)
    }
}

fn string_end(css: &str, start: usize) -> usize {
    let bytes = css.as_bytes();
    let quote = bytes[start];
    let mut index = start + 1;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' => index += 2,
            b'\n' => return index,
            byte if byte == quote => return index + 1,
            _ => index += 1,
        }
    }
    bytes.len()
}

fn is_url_function(css: &str, index: usize) -> bool {
    css.get(index..index + 4)
        .is_some_and(|name| name.eq_ignore_ascii_case("url("))
        && !css[..index].chars().next_back().is_some_and(is_ident_char)
}

// Quoted urls are skipped as strings, so only the `url` name is skipped and
// its parentheses are tracked as usual, unquoted ones are skipped entirely
fn url_end(css: &str, start: usize) -> usize {
    let arguments_start = start + 4;
    let arguments = &css[arguments_start..];
    if arguments.trim_start().starts_with(['"', '\'']) {
        return start + 3;
    }
    let mut index = arguments_start;
    while index < css.len() {
        match css.as_bytes()[index] {
            b'\\' => index = escape_end(css, index),
            b')' => return index + 1,
            _ => index += 1,
        }
    }
    css.len()
}

// Returns the at-rule and its lowercase name without vendor prefix, e.g.
// `@-webkit-Keyframes` -> `keyframes`, at-rule names are case-insensitive
fn at_rule_name(rest: &str) -> Option<(&str, String)> {
    let name_len = rest[1..]
        .find(|character: char| !is_ident_char(character))
        .map_or(rest.len(), |end| end + 1);
    let at_rule = &rest[..name_len];
    let name = at_rule[1..].to_ascii_lowercase();
    let unprefixed = match name.strip_prefix('-') {
        Some(prefixed) => prefixed.split_once('-')?.1.to_owned(),
        None => name,
    };
    Some((at_rule, unprefixed))
}

fn is_ident_char(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || character == '-'
        || character == '_'
        || character == '\\'
        || !character.is_ascii()
}

fn keyframes_message(at_rule: &str, tag_type: &str, enclosing_block: Option<&Block<'_>>) -> String {
    match (tag_type, enclosing_block) {
        ("createGlobalStyle", Some(Block::OtherAtRule(enclosing_at_rule))) => format!(
            "`{at_rule}` is not supported inside `{enclosing_at_rule}` rules, move it to the top level of `createGlobalStyle`"
        ),
        ("createGlobalStyle", _) => format!(
            "`{at_rule}` is not supported inside style rules, move it to the top level of `createGlobalStyle`"
        ),
        ("keyframes", _) => format!(
            "`{at_rule}` is not supported inside `keyframes` templates, they already generate the `@keyframes` rule so write only the frames, e.g. `from {{ ... }} to {{ ... }}`"
        ),
        _ => format!(
            "`{at_rule}` is not supported inside `{tag_type}` templates, use the `keyframes` function instead"
        ),
    }
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
    use oxc_span::Span;

    use super::{SegmentOrigin, TemplateSegment, find_unsupported_syntax, segment_source_span};

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

    #[test]
    fn falls_back_to_the_quasi_when_escapes_make_the_location_ambiguous() {
        let source = r#"content: "\u003aglobal"; :global(.a) & {} content: ":global";"#;
        let css = r#"content: ":global"; :global(.a) & {} content: ":global";"#;
        let quasi_span = Span::new(0, u32::try_from(source.len()).unwrap_or(0));
        let segment = TemplateSegment {
            range: 0..css.len(),
            origin: SegmentOrigin::Quasi(quasi_span),
        };
        let start = css.find(":global(").unwrap_or(0);
        assert_eq!(
            segment_source_span(css, source, &segment, start..start + 7),
            quasi_span
        );
    }
}
