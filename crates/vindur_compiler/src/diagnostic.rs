use oxc_diagnostics::OxcDiagnostic;
use oxc_span::Span;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePosition {
    pub line: u32,
    pub column: u32,
    pub offset: u32,
}

#[derive(Clone, Debug, Deserialize, Error, Serialize)]
#[error("{message}")]
#[serde(rename_all = "camelCase")]
pub struct CompilerDiagnostic {
    pub message: String,
    pub file_path: String,
    pub severity: DiagnosticSeverity,
    pub ignore_in_lint: bool,
    pub start: SourcePosition,
    pub end: SourcePosition,
}

impl CompilerDiagnostic {
    pub(crate) fn from_oxc(
        file_path: &str,
        source: &str,
        diagnostic: &OxcDiagnostic,
        message_prefix: &str,
    ) -> Self {
        let span = diagnostic
            .labels
            .as_slice()
            .first()
            .map_or(Span::new(0, 0), |label| {
                Span::new(label.offset(), label.offset() + label.len())
            });
        Self::error(
            file_path,
            source,
            span,
            format!("{message_prefix}{diagnostic}"),
        )
    }

    pub(crate) fn error(file_path: &str, source: &str, span: Span, message: String) -> Self {
        Self::new(file_path, source, span, message, DiagnosticSeverity::Error)
    }

    pub(crate) fn warning(file_path: &str, source: &str, span: Span, message: String) -> Self {
        Self::new(
            file_path,
            source,
            span,
            message,
            DiagnosticSeverity::Warning,
        )
    }

    pub(crate) fn new(
        file_path: &str,
        source: &str,
        span: Span,
        message: String,
        severity: DiagnosticSeverity,
    ) -> Self {
        Self {
            message,
            file_path: file_path.to_owned(),
            severity,
            ignore_in_lint: false,
            start: position_at(source, span.start),
            end: position_at(source, span.end),
        }
    }

    #[must_use]
    pub(crate) fn ignored_in_lint(mut self) -> Self {
        self.ignore_in_lint = true;
        self
    }
}

fn position_at(source: &str, offset: u32) -> SourcePosition {
    let mut bounded_offset = usize::try_from(offset)
        .unwrap_or(source.len())
        .min(source.len());
    // A wrong offset must not panic, it is moved to the start of its character
    while !source.is_char_boundary(bounded_offset) {
        bounded_offset -= 1;
    }
    // Line breaks are counted like in JS and ESLint, `\r\n`, `\n`, `\r`, U+2028 and U+2029
    let mut line = 1_usize;
    let mut line_start = 0;
    for (index, character) in source[..bounded_offset].char_indices() {
        let is_line_break = match character {
            '\n' | '\u{2028}' | '\u{2029}' => true,
            '\r' => !source[index + 1..].starts_with('\n'),
            _ => false,
        };
        if is_line_break {
            line += 1;
            line_start = index + character.len_utf8();
        }
    }
    let line = u32::try_from(line).unwrap_or(u32::MAX);
    let column = u32::try_from(source[line_start..bounded_offset].encode_utf16().count())
        .unwrap_or(u32::MAX);

    SourcePosition {
        line,
        column,
        offset,
    }
}

#[cfg(test)]
mod tests {
    use super::position_at;

    #[test]
    fn counts_line_breaks_like_js() {
        let source = "a\r\nb\rc\nd\u{2028}e";
        let position = |offset: usize| {
            let position = position_at(source, u32::try_from(offset).unwrap_or(u32::MAX));
            (position.line, position.column)
        };
        assert_eq!(position(source.find('b').unwrap_or(0)), (2, 0));
        assert_eq!(position(source.find('c').unwrap_or(0)), (3, 0));
        assert_eq!(position(source.find('d').unwrap_or(0)), (4, 0));
        assert_eq!(position(source.find('e').unwrap_or(0)), (5, 0));
    }
}
