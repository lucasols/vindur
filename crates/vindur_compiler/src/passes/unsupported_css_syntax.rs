use oxc_span::Span;

use super::css_tokens::{
    block_end, decode_ident, ident_end, is_css_whitespace, is_ident_char, skipped_token_end,
    unprefixed_at_rule_name,
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
        if starts_with_pseudo_class(rest, GLOBAL_SELECTOR)
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
        // A selector can start with an attribute, like `[href]:hover`
        if matches!(byte, b'(' | b'[') && prelude_start.is_none() {
            prelude_start = Some(index);
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
                if let (Block::Style { .. }, Some(start)) = (block, prelude_start)
                    && is_nested_rule(tag_type, &blocks)
                    && let Some((offset, selector)) =
                        bare_pseudo_selector(css, start, index, is_in_scope_rule(&blocks))
                {
                    return Some(UnsupportedSyntax {
                        offset,
                        len: selector.len(),
                        message: bare_pseudo_selector_message(selector),
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

// Rules at the root of scoped templates are nested in the generated class
fn is_nested_rule(tag_type: &str, blocks: &[Block<'_>]) -> bool {
    tag_type != "createGlobalStyle" || blocks.iter().any(|block| !matches!(block, Block::Grouping))
}

// Stylis 3 (Linaria, styled-components v5) attaches every nested selector starting with a
// pseudo-class or pseudo-element to the parent selector, like `&:hover` or `&:not(.a &)`, but
// native CSS nesting reads it as a descendant, `& :hover`, or as written when it contains `&`, so
// code migrated from it silently changes meaning. Returns the offset and text of the first
// comma-separated selector that starts with `:` and doesn't match the same elements in both,
// rules directly in `@scope` can use `:scope` instead
fn bare_pseudo_selector(
    css: &str,
    start: usize,
    end: usize,
    in_scope_rule: bool,
) -> Option<(usize, &str)> {
    selector_list_parts(css, start, end)
        .into_iter()
        .find(|(_, part)| {
            part.starts_with(':')
                && !(in_scope_rule && has_scope_selector(part))
                && !is_anchored_is_or_where(part)
        })
}

// A leading `:is()` or `:where()` anchors the selector to the parent when either:
// - each of its selectors has a single `&`, outside nested pseudo-classes, and no `&` follows it,
//   like `:where(body.x &)`, `:where(& .text)` or `:is(&.a):hover .icon`
// - its selectors have no `&` and the selector ends with a single `&` compound, like
//   `:where(.dark) &` or `:is(.dark) > &`
// More `&`, like `:is(& + &)` or `:is(&) + &`, match other elements when the parent is a selector
// list, as native nesting matches each `&` with any of its selectors
fn is_anchored_is_or_where(selector: &str) -> bool {
    let Some(name_len) = [":is", ":where"]
        .into_iter()
        .find(|name| starts_with_pseudo_class(selector, name))
        .map(str::len)
    else {
        return false;
    };
    if !selector[name_len..].starts_with('(') {
        return false;
    }
    let top_level = top_level_bytes(selector);
    let Some(close) = top_level
        .iter()
        .find(|(_, byte)| *byte == b')')
        .map(|(index, _)| *index)
    else {
        return false;
    };
    let arguments = selector_list_parts(selector, name_len + 1, close);
    let rest = &selector[close + 1..];
    if arguments
        .iter()
        .all(|(_, argument)| !argument.is_empty() && parent_selector_count(argument) == 0)
    {
        return parent_selector_count(rest) == 1 && last_compound_has_ampersand(rest);
    }
    arguments.iter().all(|(_, argument)| {
        parent_selector_count(argument) == 1 && top_level_ampersand_count(argument) == 1
    }) && parent_selector_count(rest) == 0
}

fn top_level_ampersand_count(selector: &str) -> usize {
    top_level_bytes(selector)
        .iter()
        .filter(|(_, byte)| *byte == b'&')
        .count()
}

fn last_compound_has_ampersand(selector: &str) -> bool {
    let top_level = top_level_bytes(selector);
    let compound_start = top_level
        .iter()
        .rev()
        .find(|(_, byte)| is_combinator(*byte))
        .map_or(0, |(index, _)| index + 1);
    top_level
        .iter()
        .any(|(index, byte)| *index >= compound_start && *byte == b'&')
}

fn is_combinator(byte: u8) -> bool {
    byte.is_ascii_whitespace() || matches!(byte, b'>' | b'+' | b'~')
}

// The bytes of a selector and their offsets, skipping comments, strings, escapes and the contents
// of parentheses and attribute selectors
fn top_level_bytes(selector: &str) -> Vec<(usize, u8)> {
    let bytes = selector.as_bytes();
    let mut top_level = Vec::new();
    let mut depth = 0_usize;
    let mut index = 0;
    while index < bytes.len() {
        if let Some(token_end) = skipped_token_end(selector, index) {
            index = token_end;
            continue;
        }
        match bytes[index] {
            byte @ (b'(' | b'[') => {
                if depth == 0 {
                    top_level.push((index, byte));
                }
                depth += 1;
            }
            byte @ (b')' | b']') => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    top_level.push((index, byte));
                }
            }
            byte if depth == 0 => top_level.push((index, byte)),
            _ => {}
        }
        index += selector[index..].chars().next().map_or(1, char::len_utf8);
    }
    top_level
}

// Rules whose nearest enclosing rule is `@scope` are relative to the scope root
fn is_in_scope_rule(blocks: &[Block<'_>]) -> bool {
    blocks
        .iter()
        .rev()
        .find(|block| !matches!(block, Block::Grouping))
        .is_some_and(|block| {
            matches!(block, Block::OtherAtRule(at_rule)
                if at_rule_name(at_rule).is_some_and(|(_, name)| name == "scope"))
        })
}

const SCOPE_SELECTOR: &str = ":scope";

// Counts `&` outside comments, strings, escapes and attribute selectors, e.g. `:hover[title='&']`
// has no parent selector
fn parent_selector_count(selector: &str) -> usize {
    count_outside_attributes(selector, |rest| rest.starts_with('&'))
}

fn has_scope_selector(selector: &str) -> bool {
    count_outside_attributes(selector, |rest| {
        starts_with_pseudo_class(rest, SCOPE_SELECTOR)
    }) > 0
}

// Counts the positions where `matches` accepts the rest of the selector, skipping comments,
// strings, escapes and the contents of attribute selectors
fn count_outside_attributes(selector: &str, matches: impl Fn(&str) -> bool) -> usize {
    let bytes = selector.as_bytes();
    let mut bracket_depth = 0_usize;
    let mut count = 0;
    let mut index = 0;
    while index < bytes.len() {
        if let Some(token_end) = skipped_token_end(selector, index) {
            index = token_end;
            continue;
        }
        match bytes[index] {
            b'[' => bracket_depth += 1,
            b']' => bracket_depth = bracket_depth.saturating_sub(1),
            _ if bracket_depth > 0 => {}
            _ if matches(&selector[index..]) => count += 1,
            _ => {}
        }
        index += selector[index..].chars().next().map_or(1, char::len_utf8);
    }
    count
}

// Splits a selector list at its top-level commas, returning the offset and text of each trimmed
// selector
fn selector_list_parts(css: &str, start: usize, end: usize) -> Vec<(usize, &str)> {
    let bytes = css.as_bytes();
    let mut parts = Vec::new();
    let mut paren_depth = 0_usize;
    let mut part_start = start;
    let mut index = start;
    while index < end {
        if let Some(token_end) = skipped_token_end(css, index) {
            index = token_end;
            continue;
        }
        match bytes[index] {
            b'(' | b'[' => paren_depth += 1,
            b')' | b']' => paren_depth = paren_depth.saturating_sub(1),
            b',' if paren_depth == 0 => {
                parts.push(trimmed_part(css, part_start, index));
                part_start = index + 1;
            }
            _ => {}
        }
        index += css[index..].chars().next().map_or(1, char::len_utf8);
    }
    parts.push(trimmed_part(css, part_start, end.min(css.len())));
    parts
}

// Trims whitespace and comments around a selector, like `/* x */ :hover /* y */`, so they aren't
// read as combinators
fn trimmed_part(css: &str, start: usize, end: usize) -> (usize, &str) {
    let mut content: Option<(usize, usize)> = None;
    let mut index = start;
    while index < end {
        let token_end = skipped_token_end(css, index).map(|token_end| token_end.min(end));
        let next = token_end
            .unwrap_or_else(|| index + css[index..].chars().next().map_or(1, char::len_utf8));
        let is_content = if css[index..].starts_with("/*") {
            false
        } else {
            token_end.is_some() || !css[index..].starts_with(is_css_whitespace)
        };
        if is_content {
            content = Some((
                content.map_or(index, |(content_start, _)| content_start),
                next,
            ));
        }
        index = next;
    }
    let (content_start, content_end) = content.unwrap_or((end, end));
    (content_start, &css[content_start..content_end])
}

fn bare_pseudo_selector_message(selector: &str) -> String {
    if parent_selector_count(selector) > 0 {
        return format!(
            "`{selector}` is ambiguous, CSS nesting doesn't attach a selector that contains `&` to the parent, so it can match elements outside of it, write `&{selector}` to match the parent itself or `*{selector}` to keep the CSS nesting meaning. A leading `:is()` or `:where()` is allowed when each of its selectors has a single `&` and the rest of the selector has none, like `:where(.dark &) .icon`, or when it has no `&` and the selector ends with `&`, like `:where(.dark) &`"
        );
    }
    format!(
        "`{selector}` is ambiguous, CSS nesting reads it as a descendant selector, write `&{selector}` to match the parent itself or `& {selector}` to match its descendants"
    )
}

// Pseudo-class names are case-insensitive, e.g. `:global` or `:scope`
fn starts_with_pseudo_class(rest: &str, pseudo_class: &str) -> bool {
    rest.get(..pseudo_class.len())
        .is_some_and(|name| name.eq_ignore_ascii_case(pseudo_class))
        && !rest[pseudo_class.len()..]
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
        "`{selector}` can't be nested in a pseudo-element rule, `&` can't represent pseudo-elements so it would never match the pseudo-element. Write it as its own rule with the full selector, e.g. `&::placeholder {{ .dark & {{}} }}` -> `.dark &::placeholder {{}}` or `&::-webkit-scrollbar-thumb {{ &:hover {{}} }}` -> `&::-webkit-scrollbar-thumb:hover {{}}`"
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
        assert_eq!(offset("&::before { [x] { color: red; } }"), Some(12));
    }

    #[test]
    fn rejects_nested_selectors_starting_with_a_pseudo_class_without_ampersand() {
        let error = |css: &str, tag_type: &str| {
            find_unsupported_syntax(css, tag_type).map(|syntax| {
                (
                    css[syntax.offset..syntax.offset + syntax.len].to_owned(),
                    syntax.message,
                )
            })
        };
        assert_eq!(
            error("a { :hover { color: red; } }", "css"),
            Some((
                ":hover".to_owned(),
                "`:hover` is ambiguous, CSS nesting reads it as a descendant selector, write `&:hover` to match the parent itself or `& :hover` to match its descendants".to_owned()
            ))
        );
        assert_eq!(
            error(":not(.a &) { color: red; }", "css"),
            Some((
                ":not(.a &)".to_owned(),
                "`:not(.a &)` is ambiguous, CSS nesting doesn't attach a selector that contains `&` to the parent, so it can match elements outside of it, write `&:not(.a &)` to match the parent itself or `*:not(.a &)` to keep the CSS nesting meaning. A leading `:is()` or `:where()` is allowed when each of its selectors has a single `&` and the rest of the selector has none, like `:where(.dark &) .icon`, or when it has no `&` and the selector ends with `&`, like `:where(.dark) &`".to_owned()
            ))
        );
        let selector = |css: &str, tag_type: &str| error(css, tag_type).map(|(text, _)| text);
        assert_eq!(
            selector("::-webkit-scrollbar { width: 0; }", "styled"),
            Some("::-webkit-scrollbar".to_owned())
        );
        assert_eq!(
            selector("&:hover, /* a, b */ :focus-visible  { color: red; }", "css"),
            Some(":focus-visible".to_owned())
        );
        assert_eq!(
            selector("@media print { :hover { color: red; } }", "css"),
            Some(":hover".to_owned())
        );
        assert_eq!(
            selector("body { ::selection { color: red; } }", "createGlobalStyle"),
            Some("::selection".to_owned())
        );
        assert_eq!(
            selector(
                "@scope (.a) { :hover { color: red; } }",
                "createGlobalStyle"
            ),
            Some(":hover".to_owned())
        );
        for (css, expected) in [
            (":hover /* & */ { color: red; }", ":hover"),
            (
                ":not([data-x=\"&\"]) { color: red; }",
                ":not([data-x=\"&\"])",
            ),
            (":hover[title='&'] { color: red; }", ":hover[title='&']"),
            (":hover[data-x=&] { color: red; }", ":hover[data-x=&]"),
            (
                "@scope (&) { :hover[title=':scope'] { color: red; } }",
                ":hover[title=':scope']",
            ),
            ("a { :scope > b { color: red; } }", ":scope > b"),
            (":not(:scope):hover { color: red; }", ":not(:scope):hover"),
            (
                "@scope (&) { :scope { :scope:hover { color: red; } } }",
                ":scope:hover",
            ),
            ("@scope (&) { :scoped { color: red; } }", ":scoped"),
            ("@scope (.a) { :hover & { color: red; } }", ":hover &"),
            ("@scope (&) { :not(.a &) { color: red; } }", ":not(.a &)"),
            (":not(.a &) { color: red; }", ":not(.a &)"),
            (":has(&) { color: red; }", ":has(&)"),
            (":hover & { color: red; }", ":hover &"),
            (":is(.a, &) { color: red; }", ":is(.a, &)"),
            (":where(&, .x) { color: red; }", ":where(&, .x)"),
            (":where(.a :not(&)) { color: red; }", ":where(.a :not(&))"),
            (":root.dark & { color: red; }", ":root.dark &"),
            (":is(& + &) { color: red; }", ":is(& + &)"),
            (":is(&) + & { color: red; }", ":is(&) + &"),
            (":is(&):not(.a &) { color: red; }", ":is(&):not(.a &)"),
            (":where([title='&']) { color: red; }", ":where([title='&'])"),
            (":is() { color: red; }", ":is()"),
            (":where(& &) { color: red; }", ":where(& &)"),
            (
                ":where(.dm &, .lm .dm &, .dm .lm .dm & &) { color: red; }",
                ":where(.dm &, .lm .dm &, .dm .lm .dm & &)",
            ),
            (":where(.dark) & .x { color: red; }", ":where(.dark) & .x"),
            (":where(.dark) & & { color: red; }", ":where(.dark) & &"),
            (
                ":where(.dark) :is(&) { color: red; }",
                ":where(.dark) :is(&)",
            ),
            (":not(.a) & { color: red; }", ":not(.a) &"),
            (":is() & { color: red; }", ":is() &"),
        ] {
            assert_eq!(selector(css, "css"), Some(expected.to_owned()), "{css}");
        }
        for css in [
            "&:hover, & ::before { color: red; }",
            ":where(&.broken) { color: red; }",
            ":where(body.x &), :is(.a &) { color: red; }",
            ":IS(.dark &, .dm >&, &.x) { color: red; }",
            ":where(&.x):hover::before { color: red; }",
            ":is(&) .child { color: red; }",
            ":where(&)>.child, :is(&.a, .b &) + .c { color: red; }",
            ":where(&.active) /* note */ { color: red; }",
            ":where(& /* x */) { color: red; }",
            ":where(& .text), :where(& /* x */ .y) { color: red; }",
            ":where(.vw25kiv-1-c0) & { color: red; }",
            ":is(.dark) > &, :where(.dark) .x & { color: red; }",
            ":is(.item).active & { color: red; }",
            "*:root.dark & { color: red; }",
            "[href]:hover { color: red; }",
            "a { [data-scrollable]::-webkit-scrollbar { width: 0; } }",
            ".a:not(:hover, :focus-within) { color: red; }",
            "> :hover { color: red; }",
            "[title=':x'] { color: red; }",
            "@scope (&) { :scope.active { color: red; } }",
            "@scope (&) { @media print { :SCOPE:hover { color: red; } } }",
            "--x: { :hover { a: b } };",
        ] {
            assert_eq!(selector(css, "css"), None, "{css}");
        }
        for css in [
            ":root { --x: red; }",
            "::selection { color: red; }",
            "@media print { :root { --x: red; } }",
            "body { [href]:hover { color: red; } }",
        ] {
            assert_eq!(selector(css, "createGlobalStyle"), None, "{css}");
        }
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
