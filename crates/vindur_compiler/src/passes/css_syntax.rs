use crate::CompilerDiagnostic;
use oxc_css_parser::{
    Allocator, ParserBuilder, ParserOptions, Syntax,
    ast::{AtRule, AtRulePrelude, Statement, Stylesheet},
    error::Error,
};

use super::css::reject_misplaced_layers;
use super::css_validation::{validate_block_kind, validate_statements};
use super::scoped_idents::collect_scoped_idents;

/// A CSS problem found while parsing a style block, `start` and `end` are byte offsets into the
/// parsed CSS
pub(crate) struct CssError {
    pub message: String,
    /// The parser error description, set only for syntax errors
    pub syntax_error: Option<String>,
    pub start: usize,
    pub end: usize,
}

impl CssError {
    pub(crate) fn new(message: String, start: usize, end: usize) -> Self {
        Self {
            message,
            syntax_error: None,
            start,
            end,
        }
    }

    fn shifted(self, offset: usize, len: usize) -> Self {
        let start = self.start.saturating_sub(offset).min(len);
        Self {
            start,
            end: self.end.saturating_sub(offset).clamp(start, len),
            ..self
        }
    }

    fn from_parser(error: &Error) -> Self {
        Self::syntax(error.kind.to_string(), error.span.start, error.span.end)
    }

    pub(super) fn syntax(description: String, start: usize, end: usize) -> Self {
        Self {
            message: format!("Invalid CSS: {description}"),
            syntax_error: Some(description),
            start,
            end,
        }
    }
}

/// Where a style block is used. Keyframes contents are parsed as the block of a `@keyframes` rule,
/// so keyframe selectors like `entry 0%` are understood
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum BlockKind {
    Style,
    Global,
    Keyframes,
}

impl BlockKind {
    pub(crate) fn from_tag_type(tag_type: &str) -> Self {
        match tag_type {
            "keyframes" => Self::Keyframes,
            "createGlobalStyle" => Self::Global,
            _ => Self::Style,
        }
    }
}

const KEYFRAMES_WRAPPER_START: &str = "@keyframes a{";

/// Parses the contents of a style block (what goes between `{` and `}`), the root accepts
/// declarations, nested rules and at-rules
pub(crate) fn parse_style_block<'a>(
    allocator: &'a Allocator,
    css: &'a str,
) -> Result<Stylesheet<'a>, CssError> {
    let stylesheet = parse_source(allocator, css)?;
    validate_statements(&stylesheet.statements, css)?;
    Ok(stylesheet)
}

fn parse_source<'a>(allocator: &'a Allocator, source: &'a str) -> Result<Stylesheet<'a>, CssError> {
    let mut parser = ParserBuilder::new(allocator, source)
        .syntax(Syntax::Css)
        .options(ParserOptions {
            block_contents: true,
            ..ParserOptions::default()
        })
        .build();
    let stylesheet = parser
        .parse::<Stylesheet>()
        .map_err(|error| CssError::from_parser(&error))?;
    if let Some(error) = parser.recoverable_errors().first() {
        return Err(CssError::from_parser(error));
    }
    Ok(stylesheet)
}

/// Parses a style block of any kind and calls `visit` with its statements, the parsed source and
/// the offset of the CSS in that source. Errors use source offsets and are mapped back to the CSS
pub(super) fn with_style_block<T>(
    css: &str,
    kind: BlockKind,
    visit: impl FnOnce(&[Statement<'_>], &str, usize) -> Result<T, CssError>,
) -> Result<T, CssError> {
    let wrapped;
    let (source, offset) = if kind == BlockKind::Keyframes {
        wrapped = format!("{KEYFRAMES_WRAPPER_START}{css}}}");
        (wrapped.as_str(), KEYFRAMES_WRAPPER_START.len())
    } else {
        (css, 0)
    };
    let allocator = Allocator::default();
    parse_source(&allocator, source)
        .map_err(|error| {
            if kind == BlockKind::Keyframes {
                keyframes_error(css, error)
            } else {
                error
            }
        })
        .and_then(|stylesheet| {
            let statements = block_statements(&stylesheet.statements, kind, source.len())?;
            validate_statements(statements, source)?;
            validate_block_kind(statements, kind)?;
            visit(statements, source, offset)
        })
        .map_err(|error| error.shifted(offset, css.len()))
}

/// Errors at the keyframes wrapper are caused by the CSS, parsing without the wrapper's `}` finds
/// the block the CSS left unclosed, or the `}` that closed the wrapper early
fn keyframes_error(css: &str, error: CssError) -> CssError {
    let unclosed = format!("{KEYFRAMES_WRAPPER_START}{css}");
    let at_wrapper_start = error.start < KEYFRAMES_WRAPPER_START.len();
    if !at_wrapper_start && error.start < unclosed.len() {
        return error;
    }
    let allocator = Allocator::default();
    match parse_source(&allocator, &unclosed) {
        Err(unclosed_error) if at_wrapper_start => {
            if unclosed_error.start >= KEYFRAMES_WRAPPER_START.len() {
                unclosed_error
            } else {
                CssError {
                    start: unclosed.len(),
                    end: unclosed.len(),
                    ..error
                }
            }
        }
        Ok(stylesheet) if !at_wrapper_start => match stylesheet.statements.first() {
            Some(Statement::AtRule(AtRule {
                block: Some(block), ..
            })) => CssError::syntax(
                "unexpected `}`".to_owned(),
                block.span.end.saturating_sub(1),
                block.span.end,
            ),
            _ => error,
        },
        _ => error,
    }
}

/// The keyframes wrapper must hold the whole source, otherwise the CSS closed it with a `}`
fn block_statements<'s, 'a>(
    statements: &'s [Statement<'a>],
    kind: BlockKind,
    source_len: usize,
) -> Result<&'s [Statement<'a>], CssError> {
    if kind != BlockKind::Keyframes {
        return Ok(statements);
    }
    match statements {
        [
            Statement::AtRule(AtRule {
                block: Some(block), ..
            }),
        ] if block.span.end == source_len => Ok(&block.statements),
        [
            Statement::AtRule(AtRule {
                block: Some(block), ..
            }),
            ..,
        ] => Err(CssError::syntax(
            "unexpected `}`".to_owned(),
            block.span.end.saturating_sub(1),
            block.span.end,
        )),
        _ => Err(CssError::syntax("unexpected `}`".to_owned(), 0, source_len)),
    }
}

/// Fails when the style block is invalid CSS, or uses scoped variables or `layer()` where they
/// are not supported
pub(crate) fn validate_style_block(css: &str, kind: BlockKind) -> Result<(), CssError> {
    with_style_block(css, kind, |statements, source, offset| {
        reject_misplaced_layers(source, statements, kind)?;
        collect_scoped_idents(statements, source, offset).map(|_| ())
    })
}

const LAYER_RULE_START: &str = "@layer ";

/// Whether `name` is a `<layer-name>`, CSS identifiers separated by `.` that are not CSS wide
/// keywords. It is checked by parsing `@layer name {}`, so escapes are handled like the browser
pub(crate) fn is_layer_name(name: &str) -> bool {
    let rule = format!("{LAYER_RULE_START}{name} {{}}");
    let allocator = Allocator::default();
    let Ok(stylesheet) = parse_source(&allocator, &rule) else {
        return false;
    };
    let name_span = LAYER_RULE_START.len()..LAYER_RULE_START.len() + name.len();
    match stylesheet.statements.as_slice() {
        [
            Statement::AtRule(AtRule {
                prelude: Some(AtRulePrelude::Layer(layers)),
                ..
            }),
        ] => match layers.names.as_slice() {
            [layer] => (layer.span.start..layer.span.end) == name_span,
            _ => false,
        },
        _ => false,
    }
}

pub(crate) fn css_error_diagnostic(
    file_path: &str,
    source: &str,
    span: oxc_span::Span,
    error: CssError,
) -> CompilerDiagnostic {
    CompilerDiagnostic::error(file_path, source, span, error.message)
}

#[cfg(test)]
mod tests {
    use super::{BlockKind, validate_style_block};
    fn error(css: &str) -> String {
        match validate_style_block(css, BlockKind::Style) {
            Ok(()) => "ok".to_owned(),
            Err(error) => format!("{} at {}..{}", error.message, error.start, error.end),
        }
    }

    fn kind_error(css: &str, kind: BlockKind) -> String {
        match validate_style_block(css, kind) {
            Ok(()) => "ok".to_owned(),
            Err(error) => format!("{} at {}..{}", error.message, error.start, error.end),
        }
    }

    #[test]
    fn locates_unclosed_keyframe_blocks() {
        assert_eq!(
            [
                kind_error(
                    "\n from { opacity: 0 }\n to { opacity: 1\n",
                    BlockKind::Keyframes
                ),
                kind_error(
                    "from { opacity: 0 } } to { opacity: 1 }",
                    BlockKind::Keyframes
                ),
            ],
            [
                "Invalid CSS: unclosed block before end of file at 26..27",
                "Invalid CSS: unexpected `}` at 20..21",
            ]
        );
    }

    #[test]
    fn ignores_scoped_text_in_prelude_comments_and_strings() {
        assert_eq!(
            error("@media (width /* ---theme */ > 1px) { color: red; }"),
            "ok"
        );
        assert_eq!(
            error("@supports selector([data-theme=\"---theme\"]) { color: red; }"),
            "ok"
        );
        assert_eq!(error("@media (a---b) { color: red; }"), "ok");
        assert_eq!(
            error("@media (---theme) { color: red; }"),
            "Scoped CSS variables are not supported in `@media` rule preludes at 7..17"
        );
    }

    #[test]
    fn validates_layer_names() {
        for name in [
            "base",
            "theme.base",
            "-moz-x",
            "_a1",
            "théme",
            "a\\ b",
            "foo\\.bar",
            "\\31 foo",
        ] {
            assert!(super::is_layer_name(name), "{name}");
        }
        for name in [
            "",
            "1a",
            "a b",
            "a}",
            "a;b",
            "a{",
            "a\\",
            "a..b",
            ".a",
            "a.",
            "initial",
            "a.INHERIT",
            "revert-layer",
            "a,b",
            "a/**/",
        ] {
            assert!(!super::is_layer_name(name), "{name}");
        }
    }
}
