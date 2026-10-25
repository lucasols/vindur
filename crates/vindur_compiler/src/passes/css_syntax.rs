use crate::CompilerDiagnostic;
use oxc_css_parser::{
    Allocator, ParserBuilder, ParserOptions, Syntax,
    ast::{AtRule, InterpolableIdent, Statement, Stylesheet},
    error::Error,
};

use super::css::reject_misplaced_layers;
use super::scoped_idents::collect_scoped_idents;
use super::unsupported_css_syntax::is_ident_char;

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

    fn syntax(description: String, start: usize, end: usize) -> Self {
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
    validate_statements(&stylesheet.statements)?;
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
                keyframes_closed_early_error(css, error)
            } else {
                error
            }
        })
        .and_then(|stylesheet| {
            let statements = block_statements(&stylesheet.statements, kind, source.len())?;
            validate_statements(statements)?;
            visit(statements, source, offset)
        })
        .map_err(|error| error.shifted(offset, css.len()))
}

/// A `}` closing the keyframes wrapper early makes the parser fail at the wrapper's own `}`,
/// parsing without it finds the `}` that closed the wrapper
fn keyframes_closed_early_error(css: &str, error: CssError) -> CssError {
    let unclosed = format!("{KEYFRAMES_WRAPPER_START}{css}");
    if error.start < unclosed.len() {
        return error;
    }
    let allocator = Allocator::default();
    let Ok(stylesheet) = parse_source(&allocator, &unclosed) else {
        return error;
    };
    match stylesheet.statements.first() {
        Some(Statement::AtRule(AtRule {
            block: Some(block), ..
        })) => CssError::syntax(
            "unexpected `}`".to_owned(),
            block.span.end.saturating_sub(1),
            block.span.end,
        ),
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

/// The CSS dialect also accepts postcss-only syntax like `$var: value;`, `*zoom: 1` or rules
/// without a selector, reject them
fn validate_statements(statements: &[Statement<'_>]) -> Result<(), CssError> {
    for statement in statements {
        match statement {
            Statement::Declaration(declaration) => {
                if let InterpolableIdent::Literal(name) = &declaration.name
                    && !is_property_name(name.raw)
                {
                    return Err(CssError::syntax(
                        format!(
                            "`{}` is not a valid property name, selectors need a `{{ ... }}` block",
                            name.raw
                        ),
                        name.span.start,
                        name.span.end,
                    ));
                }
            }
            Statement::QualifiedRule(rule) => {
                if rule.selector.selectors.is_empty() {
                    return Err(CssError::syntax(
                        "expected a selector before `{`".to_owned(),
                        rule.block.span.start,
                        rule.block.span.start + 1,
                    ));
                }
                validate_statements(&rule.block.statements)?;
            }
            Statement::UnknownQualifiedRule(rule) => {
                validate_statements(&rule.block.statements)?;
            }
            Statement::KeyframeBlock(block) => validate_statements(&block.block.statements)?,
            Statement::AtRule(rule) => {
                if let Some(block) = &rule.block {
                    validate_statements(&block.statements)?;
                }
            }
            Statement::PostcssSimpleVarDeclaration(declaration) => {
                return Err(CssError::new(
                    "Invalid CSS: `$` variables are not supported, use scoped CSS variables (`---name`) instead"
                        .to_owned(),
                    declaration.span.start,
                    declaration.span.end,
                ));
            }
            statement => {
                let span = statement_span(statement);
                return Err(CssError::new(
                    "Invalid CSS: unsupported statement".to_owned(),
                    span.start,
                    span.end,
                ));
            }
        }
    }
    Ok(())
}

fn statement_span(statement: &Statement<'_>) -> oxc_css_parser::Span {
    match statement {
        Statement::AtRule(rule) => rule.span,
        Statement::Declaration(declaration) => declaration.span,
        Statement::KeyframeBlock(block) => block.span,
        Statement::LessConditionalQualifiedRule(rule) => rule.span,
        Statement::LessExtendRule(rule) => rule.span,
        Statement::LessFunctionCall(function) => function.span,
        Statement::LessMixinCall(call) => call.span,
        Statement::LessMixinDefinition(definition) => definition.span,
        Statement::LessVariableCall(call) => call.span,
        Statement::LessVariableDeclaration(declaration) => declaration.span,
        Statement::Placeholder(placeholder) => placeholder.span,
        Statement::PostcssSimpleVarDeclaration(declaration) => declaration.span,
        Statement::QualifiedRule(rule) => rule.span,
        Statement::SassIfAtRule(rule) => rule.span,
        Statement::SassVariableDeclaration(declaration) => declaration.span,
        Statement::UnknownQualifiedRule(rule) => rule.span,
        Statement::UnknownSassAtRule(rule) => rule.span,
    }
}

/// The CSS dialect also accepts postcss property names like `*zoom` or `&`, which usually come
/// from a selector missing its `{ ... }` block
fn is_property_name(name: &str) -> bool {
    let (body, mut needs_name_start) = match name.strip_prefix("--") {
        Some(custom) => (custom, false),
        None => (name.strip_prefix('-').unwrap_or(name), true),
    };
    let mut characters = body.chars().peekable();
    while let Some(character) = characters.next() {
        let is_valid = match character {
            '\\' => skip_escape(&mut characters),
            _ if needs_name_start => {
                character.is_ascii_alphabetic() || character == '_' || !character.is_ascii()
            }
            _ => is_ident_char(character),
        };
        if !is_valid {
            return false;
        }
        needs_name_start = false;
    }
    !needs_name_start
}

/// Skips an escape after its `\`, a hex escape can be followed by one whitespace
fn skip_escape(characters: &mut std::iter::Peekable<std::str::Chars<'_>>) -> bool {
    let Some(escaped) = characters.next() else {
        return false;
    };
    if escaped == '\n' {
        return false;
    }
    if escaped.is_ascii_hexdigit() {
        for _ in 0..5 {
            if characters.next_if(char::is_ascii_hexdigit).is_none() {
                break;
            }
        }
        characters.next_if(|character| character.is_ascii_whitespace());
    }
    true
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

    #[test]
    fn rejects_selectors_without_a_block() {
        assert_eq!(
            [
                error("&:hover\ncolor: red;"),
                error("color: red;\n&:focus"),
                error("{ color: blue; }"),
                error("*zoom: 1;"),
            ],
            [
                "Invalid CSS: `&` is not a valid property name, selectors need a `{ ... }` block at 0..1",
                "Invalid CSS: `&` is not a valid property name, selectors need a `{ ... }` block at 12..13",
                "Invalid CSS: expected a selector before `{` at 0..1",
                "Invalid CSS: `*zoom` is not a valid property name, selectors need a `{ ... }` block at 0..5",
            ]
        );
    }

    #[test]
    fn accepts_valid_property_names() {
        assert_eq!(
            error("-webkit-box-shadow: none; --x: 1; ---y: 2; _height: 1px; \\63 olor: red; ñ: 1;"),
            "ok"
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
            "Scoped CSS variables are not supported in `@media` rule conditions at 7..17"
        );
    }
}
