use std::ops::Range;

use oxc_span::Span;

use crate::CompilerDiagnostic;

const GLOBAL_SELECTOR: &str = ":global";
const KEYFRAMES_AT_RULE: &str = "keyframes";

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

#[derive(Clone, Copy, PartialEq)]
enum Block {
    AtRule,
    StyleRule,
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
// falling back to the whole quasi when it can't be found there
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
    let mut blocks: Vec<Block> = Vec::new();
    let mut prelude_is_at_rule: Option<bool> = None;
    let mut index = 0;
    while index < bytes.len() {
        let rest = &css[index..];
        if let Some(comment) = rest.strip_prefix("/*") {
            index = comment
                .find("*/")
                .map_or(css.len(), |end| index + 2 + end + 2);
            continue;
        }
        let byte = bytes[index];
        if byte == b'"' || byte == b'\'' {
            index = string_end(css, index);
            continue;
        }
        if byte == b'\\' {
            index += 1 + rest[1..].chars().next().map_or(0, char::len_utf8);
            continue;
        }
        if is_url_function(css, index) {
            index = url_end(css, index);
            continue;
        }
        if rest.starts_with(GLOBAL_SELECTOR)
            && !rest[GLOBAL_SELECTOR.len()..]
                .chars()
                .next()
                .is_some_and(is_ident_char)
        {
            return Some(UnsupportedSyntax {
                offset: index,
                len: GLOBAL_SELECTOR.len(),
                message: global_selector_message(rest, tag_type).to_owned(),
            });
        }
        if byte == b'@'
            && let Some(at_rule) = keyframes_at_rule(rest)
        {
            let is_allowed = tag_type == "createGlobalStyle" && !blocks.contains(&Block::StyleRule);
            if !is_allowed {
                return Some(UnsupportedSyntax {
                    offset: index,
                    len: at_rule.len(),
                    message: keyframes_message(at_rule, tag_type),
                });
            }
        }
        match byte {
            b'{' => {
                blocks.push(if prelude_is_at_rule == Some(true) {
                    Block::AtRule
                } else {
                    Block::StyleRule
                });
                prelude_is_at_rule = None;
            }
            b'}' => {
                blocks.pop();
                prelude_is_at_rule = None;
            }
            b';' => prelude_is_at_rule = None,
            byte if !byte.is_ascii_whitespace() && prelude_is_at_rule.is_none() => {
                prelude_is_at_rule = Some(byte == b'@');
            }
            _ => {}
        }
        index += rest.chars().next().map_or(1, char::len_utf8);
    }
    None
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

// Quoted urls are skipped as strings, only unquoted ones need to be skipped here
fn url_end(css: &str, start: usize) -> usize {
    let arguments_start = start + 4;
    let arguments = &css[arguments_start..];
    if arguments.trim_start().starts_with(['"', '\'']) {
        return arguments_start;
    }
    arguments
        .find(')')
        .map_or(css.len(), |end| arguments_start + end + 1)
}

// Matches `@keyframes` and vendor prefixed variants like `@-webkit-keyframes`,
// at-rule names are case-insensitive
fn keyframes_at_rule(rest: &str) -> Option<&str> {
    let name_len = rest[1..]
        .find(|character: char| !is_ident_char(character))
        .map_or(rest.len(), |end| end + 1);
    let at_rule = &rest[..name_len];
    let name = at_rule[1..].to_ascii_lowercase();
    let unprefixed = match name.strip_prefix('-') {
        Some(prefixed) => prefixed.split_once('-')?.1,
        None => name.as_str(),
    };
    (unprefixed == KEYFRAMES_AT_RULE).then_some(at_rule)
}

fn is_ident_char(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || character == '-'
        || character == '_'
        || character == '\\'
        || !character.is_ascii()
}

fn keyframes_message(at_rule: &str, tag_type: &str) -> String {
    match tag_type {
        "createGlobalStyle" => format!(
            "`{at_rule}` is not supported inside style rules, move it to the top level of `createGlobalStyle`"
        ),
        "keyframes" => format!(
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
