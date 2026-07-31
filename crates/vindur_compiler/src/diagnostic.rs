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
    let bounded_offset = usize::try_from(offset)
        .unwrap_or(source.len())
        .min(source.len());
    let prefix = &source[..bounded_offset];
    let line_start = prefix.rfind('\n').map_or(0, |index| index + 1);
    let line =
        u32::try_from(prefix.bytes().filter(|byte| *byte == b'\n').count() + 1).unwrap_or(u32::MAX);
    let column = u32::try_from(source[line_start..bounded_offset].encode_utf16().count())
        .unwrap_or(u32::MAX);

    SourcePosition {
        line,
        column,
        offset,
    }
}
