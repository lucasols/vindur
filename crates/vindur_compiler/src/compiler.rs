use std::sync::{Arc, RwLock};

use oxc_allocator::Allocator;
use oxc_ast::ast::{ImportDeclarationSpecifier, Program, Statement};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{SourceType, Span};
use rustc_hash::{FxHashMap, FxHashSet};
use serde::{Deserialize, Serialize};

use crate::normalize::normalize_code;
use crate::passes::transform_program;
use crate::{
    CompilerDiagnostic, DiagnosticSeverity, ModuleFacts, ModuleId, SourceLoader, TransformOptions,
    edit::apply_edits,
    facts::StaticValue,
    resolver::{
        NoopLoader, clear_resolver_cache, has_source_extension, resolve_import_path,
        unresolved_import_path,
    },
};

type LoadedImports = (FxHashMap<String, StaticValue>, Vec<String>);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOutput {
    pub code: String,
    pub css: String,
    pub style_dependencies: Vec<String>,
    pub diagnostics: Vec<CompilerDiagnostic>,
    pub css_source_offsets: Vec<u32>,
}

#[derive(Default)]
pub struct Compiler {
    module_facts: RwLock<FxHashMap<ModuleId, Arc<ModuleFacts>>>,
}

impl Compiler {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn transform(
        &self,
        file_path: &str,
        source: &str,
        options: &TransformOptions,
    ) -> TransformOutput {
        self.transform_with_loader(file_path, source, options, &mut NoopLoader)
    }

    pub fn transform_with_loader(
        &self,
        file_path: &str,
        source: &str,
        options: &TransformOptions,
        loader: &mut impl SourceLoader,
    ) -> TransformOutput {
        self.transform_internal(
            file_path,
            source,
            options,
            loader,
            &mut FxHashSet::default(),
        )
    }

    fn transform_internal(
        &self,
        file_path: &str,
        source: &str,
        options: &TransformOptions,
        loader: &mut impl SourceLoader,
        visiting: &mut FxHashSet<String>,
    ) -> TransformOutput {
        visiting.insert(file_path.to_owned());
        let source_type = match SourceType::from_path(file_path) {
            Ok(source_type) => source_type.with_module(true),
            Err(error) => {
                return failed_output(
                    source,
                    CompilerDiagnostic::error(
                        file_path,
                        source,
                        Span::new(0, 0),
                        error.to_string(),
                    ),
                );
            }
        };
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, source_type).parse();

        if let Some(diagnostic) = parsed.diagnostics.first() {
            return failed_output(
                source,
                CompilerDiagnostic::from_oxc(file_path, source, diagnostic, ""),
            );
        }

        let semantic_return = SemanticBuilder::new_compiler()
            .with_cfg(false)
            .with_build_nodes(false)
            .build(&parsed.program);
        if let Some(diagnostic) = semantic_return.diagnostics.first() {
            return failed_output(
                source,
                CompilerDiagnostic::from_oxc(file_path, source, diagnostic, ""),
            );
        }
        let semantic = semantic_return.semantic;

        let (imported_values, dependencies) = match self.load_imported_values(
            &parsed.program,
            file_path,
            source,
            options,
            loader,
            visiting,
        ) {
            Ok(Some(result)) => result,
            Ok(None) => {
                return TransformOutput {
                    code: source.to_owned(),
                    css: String::new(),
                    style_dependencies: Vec::new(),
                    diagnostics: Vec::new(),
                    css_source_offsets: Vec::new(),
                };
            }
            Err(diagnostic) => return failed_output(source, diagnostic),
        };

        let mut pass_output = match transform_program(
            &parsed.program,
            semantic.scoping(),
            file_path,
            source,
            options,
            &imported_values,
        ) {
            Ok(output) => output,
            Err(diagnostic) => return failed_output(source, diagnostic),
        };
        pass_output.facts.dependencies.clone_from(&dependencies);
        let edited_code = match apply_edits(file_path, source, &mut pass_output.edits) {
            Ok(code) => code,
            Err(diagnostic) => return failed_output(source, diagnostic),
        };
        let code = if options.normalize_code {
            match normalize_code(file_path, &edited_code, source_type) {
                Ok(code) => code,
                Err(diagnostic) => return failed_output(source, diagnostic),
            }
        } else {
            edited_code
        };

        {
            let mut facts = self
                .module_facts
                .write()
                .unwrap_or_else(|error| error.into_inner());
            facts.insert(Arc::from(file_path), Arc::new(pass_output.facts));
        }

        TransformOutput {
            code,
            css: pass_output.css,
            style_dependencies: dependencies,
            diagnostics: pass_output.warnings,
            css_source_offsets: pass_output.css_source_offsets,
        }
    }

    fn load_imported_values(
        &self,
        program: &Program<'_>,
        file_path: &str,
        source: &str,
        options: &TransformOptions,
        loader: &mut impl SourceLoader,
        visiting: &mut FxHashSet<String>,
    ) -> Result<Option<LoadedImports>, CompilerDiagnostic> {
        let mut values = FxHashMap::default();
        let mut dependencies = Vec::new();
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else {
                continue;
            };
            if import.source.value.as_str() == "vindur" {
                continue;
            }
            let resolved = resolve_import_path(
                file_path,
                import.source.value.as_str(),
                &options.import_aliases,
                loader,
            )
            .map_err(|message| {
                CompilerDiagnostic::error(file_path, source, import.span, message)
            })?;
            let Some(resolved) = resolved else {
                if unresolved_import_path(
                    file_path,
                    import.source.value.as_str(),
                    &options.import_aliases,
                )
                .is_some_and(|unresolved| {
                    visiting
                        .iter()
                        .any(|visited| paths_refer_to_same_module(visited, &unresolved))
                }) && visiting.len() > 2
                {
                    return Ok(None);
                }
                if import.specifiers.as_ref().is_some_and(|specifiers| {
                    specifiers.iter().any(|specifier| {
                        let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier
                        else {
                            return false;
                        };
                        source.contains(&format!("{}(", specifier.local.name))
                    })
                }) && let Some(unresolved) = unresolved_import_path(
                    file_path,
                    import.source.value.as_str(),
                    &options.import_aliases,
                ) {
                    let attempted = if has_source_extension(&unresolved) {
                        unresolved
                    } else {
                        format!("{unresolved}.ts")
                    };
                    return Err(CompilerDiagnostic::error(
                        file_path,
                        source,
                        import.span,
                        format!("File not found: {attempted}"),
                    ));
                }
                continue;
            };
            let Some(facts) = self.load_module_facts(&resolved, options, loader, visiting)? else {
                if visiting.len() > 2 {
                    return Ok(None);
                }
                continue;
            };
            let Some(specifiers) = &import.specifiers else {
                continue;
            };
            let mut needs_dependency = false;
            for specifier in specifiers {
                let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                    continue;
                };
                if let Some(value) = facts.exports.get(specifier.imported.name().as_str()) {
                    needs_dependency |= !matches!(value, StaticValue::Keyframes(_));
                    let value = match value {
                        StaticValue::Object(properties) => StaticValue::ImportedObject {
                            properties: properties.clone(),
                            source_path: resolved.clone(),
                        },
                        StaticValue::String(_)
                        | StaticValue::Number(_)
                        | StaticValue::Boolean(_)
                        | StaticValue::Array(_) => StaticValue::ImportedValue {
                            source_path: resolved.clone(),
                            value: Box::new(value.clone()),
                        },
                        value => value.clone(),
                    };
                    values.insert(specifier.local.name.to_string(), value);
                } else if let Some(StaticValue::ThemeColors(colors)) =
                    facts.constants.get(specifier.imported.name().as_str())
                {
                    needs_dependency = true;
                    values.insert(
                        specifier.local.name.to_string(),
                        StaticValue::UnexportedThemeColors(colors.clone()),
                    );
                } else {
                    let imported_name = specifier.imported.name().as_str();
                    let value = if facts
                        .declared_object_exports
                        .iter()
                        .any(|name| name == imported_name)
                    {
                        StaticValue::InvalidObject {
                            source_path: resolved.clone(),
                        }
                    } else if facts
                        .declared_exports
                        .iter()
                        .any(|name| name == imported_name)
                    {
                        StaticValue::InvalidFunction {
                            source_path: resolved.clone(),
                        }
                    } else {
                        StaticValue::MissingImport {
                            imported_name: specifier.imported.name().to_string(),
                            source_path: resolved.clone(),
                        }
                    };
                    values.insert(specifier.local.name.to_string(), value);
                }
            }
            if needs_dependency {
                dependencies.push(resolved);
            }
        }
        Ok(Some((values, dependencies)))
    }

    fn load_module_facts(
        &self,
        file_path: &str,
        options: &TransformOptions,
        loader: &mut impl SourceLoader,
        visiting: &mut FxHashSet<String>,
    ) -> Result<Option<Arc<ModuleFacts>>, CompilerDiagnostic> {
        if let Some(facts) = self.cached_facts(file_path) {
            return Ok(Some(facts));
        }
        if visiting.contains(file_path) {
            return Ok(None);
        }
        let source = loader.read_file(file_path).map_err(|message| {
            CompilerDiagnostic::error(file_path, "", Span::new(0, 0), message)
        })?;
        let mut dependency_options = options.clone();
        dependency_options.normalize_code = false;
        let output =
            self.transform_internal(file_path, &source, &dependency_options, loader, visiting);
        visiting.remove(file_path);
        if let Some(diagnostic) = output
            .diagnostics
            .into_iter()
            .find(|diagnostic| diagnostic.severity == DiagnosticSeverity::Error)
        {
            return Err(diagnostic);
        }
        Ok(self.cached_facts(file_path))
    }

    fn cached_facts(&self, file_path: &str) -> Option<Arc<ModuleFacts>> {
        let facts = self
            .module_facts
            .read()
            .unwrap_or_else(|error| error.into_inner());
        facts.get(file_path).cloned()
    }

    pub fn invalidate(&self, file_path: &str) {
        clear_resolver_cache();
        let mut facts = self
            .module_facts
            .write()
            .unwrap_or_else(|error| error.into_inner());
        facts.remove(file_path);
    }

    pub fn clear(&self) {
        clear_resolver_cache();
        let mut facts = self
            .module_facts
            .write()
            .unwrap_or_else(|error| error.into_inner());
        facts.clear();
    }
}

fn paths_refer_to_same_module(left: &str, right: &str) -> bool {
    let left = std::path::Path::new(left);
    let right = std::path::Path::new(right);
    left == right || left.with_extension("") == right || left == right.with_extension("")
}

fn failed_output(source: &str, diagnostic: CompilerDiagnostic) -> TransformOutput {
    TransformOutput {
        code: source.to_owned(),
        css: String::new(),
        style_dependencies: Vec::new(),
        diagnostics: vec![diagnostic],
        css_source_offsets: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use rustc_hash::FxHashMap;

    use super::Compiler;
    use crate::{SourceLoader, TransformOptions};

    struct MemoryLoader {
        files: FxHashMap<String, String>,
        reads: usize,
    }

    impl SourceLoader for MemoryLoader {
        fn exists(&mut self, file_path: &str) -> Result<bool, String> {
            Ok(self.files.contains_key(file_path))
        }

        fn read_file(&mut self, file_path: &str) -> Result<String, String> {
            self.reads += 1;
            self.files
                .get(file_path)
                .cloned()
                .ok_or_else(|| format!("File not found: {file_path}"))
        }
    }

    #[test]
    fn parses_tsx_and_preserves_unmodified_source() {
        let source = "const App = () => <main>Hello</main>;";
        let output = Compiler::new().transform("/App.tsx", source, &TransformOptions::default());

        assert!(output.diagnostics.is_empty());
        assert_eq!(output.code, source);
    }

    #[test]
    fn reports_parse_errors_with_a_source_location() {
        let output = Compiler::new().transform(
            "/App.tsx",
            "const App = <main>;",
            &TransformOptions::default(),
        );

        assert_eq!(output.diagnostics.len(), 1);
        assert_eq!(output.diagnostics[0].file_path, "/App.tsx");
        assert!(output.diagnostics[0].start.line > 0);
    }

    #[test]
    fn transforms_direct_css_tags_inside_expressions() {
        let output = Compiler::new().transform(
            "/direct.ts",
            "import { css } from 'vindur';\nconsole.log(css`color: red;`);",
            &TransformOptions::default(),
        );

        assert!(output.diagnostics.is_empty());
        assert_eq!(output.code, "console.log(\"vfg87vj-1\");");
        assert_eq!(output.css, ".vfg87vj-1 {\n  color: red;\n}");
    }

    #[test]
    fn uses_semantic_symbols_to_ignore_shadowed_vindur_imports() {
        let source = "import { css } from 'vindur';\nconst top = css`color: red;`;\nfunction render(css: (value: TemplateStringsArray) => string) { return css`untouched`; }";
        let output = Compiler::new().transform(
            "/shadowed.ts",
            source,
            &TransformOptions {
                normalize_code: true,
                ..TransformOptions::default()
            },
        );

        assert!(output.diagnostics.is_empty());
        assert_eq!(
            output.code,
            "const top = \"vqys53f-1\";\nfunction render(css: (value: TemplateStringsArray) => string) { return css`untouched`; }"
        );
        assert_eq!(output.css, ".vqys53f-1 {\n  color: red;\n}");
    }

    #[test]
    fn uses_ecmascript_number_to_string_semantics() {
        let source = "import { css } from 'vindur'; const negativeZero = 0 / -1; const style = css`padding: ${negativeZero}px;`;";
        let output = Compiler::new().transform(
            "/number.ts",
            source,
            &TransformOptions {
                normalize_code: false,
                ..TransformOptions::default()
            },
        );

        assert!(output.diagnostics.is_empty());
        assert_eq!(output.css, ".versdpu-1 {\n  padding: 0px;\n}");
    }

    #[test]
    fn does_not_evaluate_shadowed_root_constants() {
        let source = "import { css } from 'vindur'; const color = 'red'; function render(color: string) { return css`color: ${color};`; }";
        let output = Compiler::new().transform(
            "/shadowed-constant.ts",
            source,
            &TransformOptions::default(),
        );

        assert_eq!(output.diagnostics.len(), 1);
        assert!(
            output.diagnostics[0]
                .message
                .starts_with("Invalid interpolation used")
        );
        assert_eq!(output.code, source);
        assert!(output.css.is_empty());
    }

    #[test]
    fn rejects_inline_styled_tags_with_a_location() {
        let output = Compiler::new().transform(
            "/inline.tsx",
            "import { styled } from 'vindur';\nconst value = () => styled.div`color: red;`;",
            &TransformOptions::default(),
        );

        assert_eq!(output.diagnostics.len(), 1);
        assert_eq!(
            output.diagnostics[0].message,
            "Inline styled component usage is not supported. Please assign styled components to a variable first."
        );
        assert_eq!(output.diagnostics[0].start.line, 2);
    }

    #[test]
    fn shares_indices_between_stable_ids_and_jsx_css_props() {
        let source = "import { stableId } from 'vindur';\nexport const id = stableId();\nconst App = () => <div css={`#${id} { color: red; }`} />;";
        let output = Compiler::new().transform(
            "/test.tsx",
            source,
            &TransformOptions {
                dev: true,
                sourcemap: false,
                normalize_code: false,
                import_aliases: FxHashMap::default(),
            },
        );

        assert!(output.diagnostics.is_empty());
        assert!(output.code.contains("\"v1560qbr-id-1\""));
        assert!(output.code.contains("className=\"v1560qbr-2-css-prop-2\""));
        assert_eq!(
            output.css,
            ".v1560qbr-2-css-prop-2 {\n  #v1560qbr-id-1 { color: red; }\n}"
        );
    }

    #[test]
    fn evaluates_imported_functions_from_cached_module_facts() {
        let compiler = Compiler::new();
        let mut loader = MemoryLoader {
            files: FxHashMap::from_iter([(
                "/functions.ts".to_owned(),
                "import { vindurFn } from 'vindur'; export const inline = vindurFn(({ gap = 8 }) => `gap: ${gap}px;`);".to_owned(),
            )]),
            reads: 0,
        };
        let options = TransformOptions {
            import_aliases: FxHashMap::from_iter([("#/".to_owned(), "/".to_owned())]),
            ..TransformOptions::default()
        };
        let source = "import { css } from 'vindur'; import { inline } from '#/functions'; const style = css`${inline({ gap: 12 })}`;";

        let first = compiler.transform_with_loader("/first.ts", source, &options, &mut loader);
        let second = compiler.transform_with_loader("/second.ts", source, &options, &mut loader);

        assert!(first.diagnostics.is_empty());
        assert!(second.diagnostics.is_empty());
        assert!(first.css.contains("gap: 12px;"));
        assert!(second.css.contains("gap: 12px;"));
        assert_eq!(loader.reads, 1);
    }
}
