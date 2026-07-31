use std::collections::HashMap;

use napi::bindgen_prelude::Function;
use napi_derive::napi;
use vindur_compiler::{
    Compiler as CoreCompiler, CompilerDiagnostic, DiagnosticSeverity as CoreDiagnosticSeverity,
    SourceLoader, TransformOptions as CoreTransformOptions,
};

#[napi(string_enum)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
}

#[napi(object)]
pub struct SourcePosition {
    pub line: u32,
    pub column: u32,
    pub offset: u32,
}

#[napi(object)]
pub struct Diagnostic {
    pub message: String,
    pub file_path: String,
    pub severity: DiagnosticSeverity,
    pub ignore_in_lint: bool,
    pub start: SourcePosition,
    pub end: SourcePosition,
}

#[napi(object)]
pub struct TransformOptions {
    pub dev: Option<bool>,
    pub sourcemap: Option<bool>,
    pub normalize_code: Option<bool>,
    pub import_aliases: Option<HashMap<String, String>>,
}

#[napi(object)]
pub struct TransformOutput {
    pub code: String,
    pub css: String,
    pub style_dependencies: Vec<String>,
    pub diagnostics: Vec<Diagnostic>,
    pub css_source_offsets: Vec<u32>,
}

#[napi]
pub struct Compiler {
    inner: CoreCompiler,
}

#[napi]
impl Compiler {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: CoreCompiler::new(),
        }
    }

    #[napi]
    pub fn transform(
        &self,
        file_path: String,
        source: String,
        options: Option<TransformOptions>,
        read_file: Option<Function<'_, String, String>>,
        exists: Option<Function<'_, String, bool>>,
    ) -> TransformOutput {
        let options = options.unwrap_or(TransformOptions {
            dev: None,
            sourcemap: None,
            normalize_code: None,
            import_aliases: None,
        });
        let mut loader = JsSourceLoader { read_file, exists };
        let result = self.inner.transform_with_loader(
            &file_path,
            &source,
            &CoreTransformOptions {
                dev: options.dev.unwrap_or(false),
                sourcemap: options.sourcemap.unwrap_or(false),
                normalize_code: options.normalize_code.unwrap_or(false),
                import_aliases: options
                    .import_aliases
                    .unwrap_or_default()
                    .into_iter()
                    .collect(),
            },
            &mut loader,
        );

        TransformOutput {
            code: result.code,
            css: result.css,
            style_dependencies: result.style_dependencies,
            diagnostics: result
                .diagnostics
                .into_iter()
                .map(convert_diagnostic)
                .collect(),
            css_source_offsets: result.css_source_offsets,
        }
    }

    #[napi]
    pub fn invalidate(&self, file_path: String) {
        self.inner.invalidate(&file_path);
    }

    #[napi]
    pub fn clear(&self) {
        self.inner.clear();
    }
}

struct JsSourceLoader<'a> {
    read_file: Option<Function<'a, String, String>>,
    exists: Option<Function<'a, String, bool>>,
}

impl SourceLoader for JsSourceLoader<'_> {
    fn exists(&mut self, file_path: &str) -> Result<bool, String> {
        let Some(exists) = &self.exists else {
            return Ok(false);
        };
        exists
            .call(file_path.to_owned())
            .map_err(|error| error.to_string())
    }

    fn read_file(&mut self, file_path: &str) -> Result<String, String> {
        let Some(read_file) = &self.read_file else {
            return Err(format!("File loader is not configured for {file_path}"));
        };
        read_file
            .call(file_path.to_owned())
            .map_err(|error| error.to_string())
    }
}

impl Default for Compiler {
    fn default() -> Self {
        Self::new()
    }
}

fn convert_diagnostic(diagnostic: CompilerDiagnostic) -> Diagnostic {
    Diagnostic {
        message: diagnostic.message,
        file_path: diagnostic.file_path,
        severity: match diagnostic.severity {
            CoreDiagnosticSeverity::Error => DiagnosticSeverity::Error,
            CoreDiagnosticSeverity::Warning => DiagnosticSeverity::Warning,
        },
        ignore_in_lint: diagnostic.ignore_in_lint,
        start: SourcePosition {
            line: diagnostic.start.line,
            column: diagnostic.start.column,
            offset: diagnostic.start.offset,
        },
        end: SourcePosition {
            line: diagnostic.end.line,
            column: diagnostic.end.column,
            offset: diagnostic.end.offset,
        },
    }
}
