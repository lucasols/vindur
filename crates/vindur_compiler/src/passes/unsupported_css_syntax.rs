use oxc_ast::ast::TemplateLiteral;
use oxc_span::Span;

use crate::CompilerDiagnostic;

const GLOBAL_SELECTOR: &str = ":global";
const KEYFRAMES_AT_RULES: [&str; 2] = ["@keyframes", "@-webkit-keyframes"];

struct UnsupportedSyntax {
    offset: usize,
    len: usize,
    message: String,
}

// Syntax that vindur doesn't process would be emitted as invalid CSS that the
// browser silently drops, so it fails the transform instead
pub(super) fn unsupported_template_syntax_error(
    template: &TemplateLiteral<'_>,
    tag_type: &str,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    template.quasis.iter().find_map(|quasi| {
        let syntax = find_unsupported_syntax(quasi.value.raw.as_str(), tag_type)?;
        let start = quasi.span.start + u32::try_from(syntax.offset).ok()?;
        let end = start + u32::try_from(syntax.len).ok()?;
        Some(CompilerDiagnostic::error(
            file_path,
            source,
            Span::new(start, end),
            syntax.message,
        ))
    })
}

pub(super) fn unsupported_interpolation_syntax_error(
    value: &str,
    span: Span,
    tag_type: &str,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let syntax = find_unsupported_syntax(value, tag_type)?;
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        span,
        format!("{} (found in the interpolated value)", syntax.message),
    ))
}

fn find_unsupported_syntax(css: &str, tag_type: &str) -> Option<UnsupportedSyntax> {
    let comments = comment_ranges(css);
    let outside_comments = |offset: &usize| {
        !comments
            .iter()
            .any(|(start, end)| (*start..*end).contains(offset))
    };

    if let Some(offset) = css
        .match_indices(GLOBAL_SELECTOR)
        .map(|(offset, _)| offset)
        .filter(outside_comments)
        .find(|offset| is_global_selector_end(css, offset + GLOBAL_SELECTOR.len()))
    {
        return Some(UnsupportedSyntax {
            offset,
            len: GLOBAL_SELECTOR.len(),
            message: global_selector_message(&css[offset..], tag_type).to_owned(),
        });
    }

    // `@keyframes` is valid at the top level of global styles
    if tag_type == "createGlobalStyle" {
        return None;
    }
    KEYFRAMES_AT_RULES.iter().find_map(|at_rule| {
        let offset = css
            .match_indices(at_rule)
            .map(|(offset, _)| offset)
            .find(outside_comments)?;
        Some(UnsupportedSyntax {
            offset,
            len: at_rule.len(),
            message: format!(
                "`{at_rule}` is not supported inside `{tag_type}` templates, use the `keyframes` function instead"
            ),
        })
    })
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

fn is_global_selector_end(css: &str, index: usize) -> bool {
    css[index..]
        .chars()
        .next()
        .is_none_or(|next| next == '(' || next == '{' || next.is_whitespace())
}

fn comment_ranges(css: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut rest_start = 0;
    while let Some(start) = css[rest_start..].find("/*").map(|index| rest_start + index) {
        let end = css[start + 2..]
            .find("*/")
            .map_or(css.len(), |index| start + 2 + index + 2);
        ranges.push((start, end));
        rest_start = end;
    }
    ranges
}
