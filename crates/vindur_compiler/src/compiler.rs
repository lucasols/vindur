use std::sync::{Arc, RwLock};

use oxc_allocator::Allocator;
use oxc_ast::ast::{ImportDeclarationSpecifier, Statement};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{SourceType, Span};
use rustc_hash::{FxHashMap, FxHashSet};
use serde::{Deserialize, Serialize};

use crate::normalize::normalize_code;
use crate::passes::transform_program;
use crate::resolved_imports::remove_resolved_imports;
use crate::{
    CompilerDiagnostic, DiagnosticSeverity, ModuleFacts, ModuleId, SourceLoader, TransformOptions,
    edit::apply_edits,
    facts::{ReExport, StaticValue},
    module_graph::{
        DependencyList, is_type_only_import, is_type_only_specifier, paths_refer_to_same_module,
    },
    resolver::{
        NoopLoader, clear_resolver_cache, has_source_extension, relative_import_specifier,
        resolve_import_path, unresolved_import_path,
    },
    semantic::ModuleSource,
};

struct LoadedImports {
    values: FxHashMap<String, StaticValue>,
    style_dependencies: Vec<String>,
    /// Modules whose facts were read directly, including ones whose values aren't static,
    /// changing any of them can change this module's facts
    fact_dependencies: Vec<String>,
    /// Modules skipped because they're in an import cycle with this module, or whose facts
    /// depend on one
    cyclic_dependencies: Vec<String>,
    /// Local names of values imported from modules whose facts depend on an import cycle
    cyclic_values: FxHashSet<String>,
    /// Import sources of modules with global styles, kept as side effect imports when all
    /// their imported values are resolved at compile time
    global_style_sources: FxHashSet<String>,
}

/// Modules of the current transform, a module importing one of the `visiting` modules is in
/// an import cycle with it
#[derive(Default)]
struct Traversal {
    visiting: FxHashSet<String>,
    /// Modules that stopped at an import cycle, so their facts aren't cached, and the
    /// modules they stopped at
    aborted: Vec<String>,
}

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
        let mut output = self.transform_internal(
            file_path,
            source,
            options,
            loader,
            &mut Traversal::default(),
        );
        output.style_dependencies =
            self.transitive_style_dependencies(file_path, &output.style_dependencies);
        output
    }

    /// Facts only keep direct dependencies, imported values can come from a dependency's
    /// own imports, so those files affect this module's styles too
    fn transitive_style_dependencies(&self, file_path: &str, direct: &[String]) -> Vec<String> {
        let facts = self
            .module_facts
            .read()
            .unwrap_or_else(|error| error.into_inner());
        let mut dependencies = DependencyList::new(file_path);
        let mut pending = direct.iter().rev().collect::<Vec<_>>();
        while let Some(dependency) = pending.pop() {
            if !dependencies.insert(dependency) {
                continue;
            }
            if let Some(module) = facts.get(dependency.as_str()) {
                pending.extend(module.dependencies.iter().rev());
            }
        }
        dependencies.paths
    }

    fn transform_internal(
        &self,
        file_path: &str,
        source: &str,
        options: &TransformOptions,
        loader: &mut impl SourceLoader,
        traversal: &mut Traversal,
    ) -> TransformOutput {
        traversal.visiting.insert(file_path.to_owned());
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

        let imports = match self.load_imported_values(
            &ModuleSource {
                program: &parsed.program,
                scoping: semantic.scoping(),
                file_path,
                source,
            },
            options,
            loader,
            traversal,
        ) {
            Ok(Some(result)) => result,
            Ok(None) => {
                traversal.aborted.push(file_path.to_owned());
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
            &imports.values,
            &imports.cyclic_values,
        ) {
            Ok(output) => output,
            Err(diagnostic) => return failed_output(source, diagnostic),
        };
        pass_output
            .facts
            .dependencies
            .clone_from(&imports.style_dependencies);
        pass_output.facts.fact_dependencies = imports.fact_dependencies;
        pass_output.facts.cyclic_dependencies = imports.cyclic_dependencies;
        let edited_code = match apply_edits(file_path, source, &mut pass_output.edits) {
            Ok(code) => code,
            Err(diagnostic) => return failed_output(source, diagnostic),
        };
        let edited_code = match remove_resolved_imports(
            file_path,
            edited_code,
            source_type,
            &imports.values,
            &imports.global_style_sources,
        ) {
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
            style_dependencies: imports.style_dependencies,
            diagnostics: pass_output.warnings,
            css_source_offsets: pass_output.css_source_offsets,
        }
    }

    fn load_imported_values(
        &self,
        module: &ModuleSource<'_, '_>,
        options: &TransformOptions,
        loader: &mut impl SourceLoader,
        traversal: &mut Traversal,
    ) -> Result<Option<LoadedImports>, CompilerDiagnostic> {
        let &ModuleSource {
            program,
            scoping,
            file_path,
            source,
        } = module;
        let mut values = FxHashMap::default();
        let mut dependencies = DependencyList::new(file_path);
        let mut fact_dependencies = DependencyList::new(file_path);
        let mut cyclic_dependencies = DependencyList::new(file_path);
        let mut cyclic_values = FxHashSet::default();
        let mut global_style_sources = FxHashSet::default();
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else {
                continue;
            };
            if import.source.value.as_str() == "vindur" || is_type_only_import(import, scoping) {
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
                    traversal
                        .visiting
                        .iter()
                        .any(|visited| paths_refer_to_same_module(visited, &unresolved))
                }) && traversal.visiting.len() > 2
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
            let Some(facts) = self.load_module_facts(&resolved, options, loader, traversal)? else {
                if traversal.visiting.len() > 2 {
                    traversal.aborted.push(resolved);
                    return Ok(None);
                }
                // Breaking the cycle changes this module's facts, the cycle can also be
                // broken in the modules that stopped at it
                fact_dependencies.insert(&resolved);
                for aborted in traversal.aborted.drain(..) {
                    fact_dependencies.insert(&aborted);
                }
                cyclic_dependencies.insert(&resolved);
                // Values imported back into the cycle are reported where they're used
                for specifier in import.specifiers.iter().flatten() {
                    if !is_type_only_specifier(specifier, scoping)
                        && let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier
                    {
                        values.insert(
                            specifier.local.name.to_string(),
                            StaticValue::CyclicImport {
                                source_path: resolved.clone(),
                            },
                        );
                    }
                }
                continue;
            };
            let Some(specifiers) = &import.specifiers else {
                continue;
            };
            fact_dependencies.insert(&resolved);
            if facts.has_global_styles {
                global_style_sources.insert(import.source.value.to_string());
            }
            // Whether this module's facts are complete depends on which module of the cycle
            // was transformed first, so values derived from them aren't static
            let has_cycle = facts.has_cycle();
            if has_cycle {
                cyclic_dependencies.insert(&resolved);
            }
            // Namespace member references can't be checked by the vindurFn runtime guard
            if let Some(ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace)) =
                specifiers.iter().find(|specifier| {
                    matches!(
                        specifier,
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(_)
                    )
                })
                && let Some(function_name) = facts
                    .exports
                    .iter()
                    .filter(|(_, value)| {
                        matches!(
                            value,
                            StaticValue::Function(_) | StaticValue::ImportedFunction(_)
                        )
                    })
                    .map(|(name, _)| name)
                    .min()
            {
                return Err(CompilerDiagnostic::error(
                    file_path,
                    source,
                    namespace.span,
                    format!(
                        "vindurFn exports of \"{}\" can't be imported with a namespace import, import them by name, e.g. import {{ {function_name} }} from \"{}\"",
                        import.source.value, import.source.value
                    ),
                ));
            }
            let mut needs_dependency = false;
            for specifier in specifiers {
                if is_type_only_specifier(specifier, scoping) {
                    continue;
                }
                let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                    continue;
                };
                if let Some(value) = facts.exports.get(specifier.imported.name().as_str()) {
                    // Keyframes names include the source file's style index
                    needs_dependency = true;
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
                    if has_cycle {
                        cyclic_values.insert(specifier.local.name.to_string());
                    }
                    values.insert(specifier.local.name.to_string(), value);
                } else if let Some(StaticValue::ThemeColors { colors, dev }) =
                    facts.constants.get(specifier.imported.name().as_str())
                {
                    needs_dependency = true;
                    values.insert(
                        specifier.local.name.to_string(),
                        StaticValue::UnexportedThemeColors {
                            colors: colors.clone(),
                            dev: *dev,
                        },
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
                            cyclic_imports: facts.cyclic_dependencies.clone(),
                        }
                    } else if facts
                        .declared_exports
                        .iter()
                        .any(|name| name == imported_name)
                    {
                        StaticValue::InvalidFunction {
                            source_path: resolved.clone(),
                            cyclic_imports: facts.cyclic_dependencies.clone(),
                        }
                    } else if let Some(re_export) = facts.re_exports.get(imported_name) {
                        StaticValue::UnsupportedReExport {
                            imported_name: imported_name.to_owned(),
                            source_path: resolved.clone(),
                            // Relative sources are relative to the re-exporting module,
                            // the error suggests importing it from this one
                            re_export: Some(ReExport {
                                source: if re_export.source.starts_with('.') {
                                    unresolved_import_path(
                                        &resolved,
                                        &re_export.source,
                                        &options.import_aliases,
                                    )
                                    .map(|target| relative_import_specifier(file_path, &target))
                                } else {
                                    None
                                }
                                .unwrap_or_else(|| re_export.source.clone()),
                                imported_name: re_export.imported_name.clone(),
                            }),
                        }
                    } else if !facts.star_re_exports.is_empty() {
                        StaticValue::UnsupportedReExport {
                            imported_name: imported_name.to_owned(),
                            source_path: resolved.clone(),
                            re_export: None,
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
                dependencies.insert(&resolved);
            }
        }
        Ok(Some(LoadedImports {
            values,
            style_dependencies: dependencies.paths,
            fact_dependencies: fact_dependencies.paths,
            cyclic_dependencies: cyclic_dependencies.paths,
            cyclic_values,
            global_style_sources,
        }))
    }

    fn load_module_facts(
        &self,
        file_path: &str,
        options: &TransformOptions,
        loader: &mut impl SourceLoader,
        traversal: &mut Traversal,
    ) -> Result<Option<Arc<ModuleFacts>>, CompilerDiagnostic> {
        if let Some(facts) = self.cached_facts(file_path) {
            return Ok(Some(facts));
        }
        if traversal.visiting.contains(file_path) {
            return Ok(None);
        }
        let source = loader.read_file(file_path).map_err(|message| {
            CompilerDiagnostic::error(file_path, "", Span::new(0, 0), message)
        })?;
        let mut dependency_options = options.clone();
        dependency_options.normalize_code = false;
        let output =
            self.transform_internal(file_path, &source, &dependency_options, loader, traversal);
        traversal.visiting.remove(file_path);
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
        // Dependents' facts were built from this module's facts, directly or indirectly
        let evicted = {
            let mut dependents = FxHashMap::<&str, Vec<&str>>::default();
            for (module_id, module) in facts.iter() {
                for dependency in &module.fact_dependencies {
                    dependents
                        .entry(dependency.as_str())
                        .or_default()
                        .push(module_id);
                }
            }
            let mut evicted = FxHashSet::default();
            let mut pending = vec![file_path];
            while let Some(path) = pending.pop() {
                if evicted.insert(path.to_owned()) {
                    pending.extend(dependents.get(path).into_iter().flatten().copied());
                }
            }
            evicted
        };
        facts.retain(|module_id, _| !evicted.contains(&**module_id));
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

fn failed_output(source: &str, diagnostic: CompilerDiagnostic) -> TransformOutput {
    TransformOutput {
        code: source.to_owned(),
        css: String::new(),
        style_dependencies: Vec::new(),
        diagnostics: vec![diagnostic],
        css_source_offsets: Vec::new(),
    }
}
