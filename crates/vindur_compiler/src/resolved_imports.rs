use crate::code_map::CodeMap;
use oxc_allocator::Allocator;
use oxc_ast::ast::{
    IdentifierReference, ImportDeclaration, ImportDeclarationSpecifier, Program, Statement,
    TSTypeQuery,
};
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, SourceType};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    CompilerDiagnostic,
    edit::{Edit, apply_edits, expand_removal_to_line},
    facts::StaticValue,
};

/// Removes imports whose values were resolved at compile time, once the transformed code no
/// longer references them. Runs on the edited code so references consumed by vindur templates
/// or inlined class names are already gone, while runtime usages keep their import.
pub(crate) fn remove_resolved_imports(
    file_path: &str,
    code: String,
    source_type: SourceType,
    imported_values: &FxHashMap<String, StaticValue>,
    side_effect_sources: &FxHashSet<String>,
    consumed_imports: &FxHashSet<String>,
) -> Result<(String, CodeMap), CompilerDiagnostic> {
    if consumed_imports.is_empty()
        && !imported_values
            .values()
            .any(|value| !is_runtime_value(value))
    {
        let map = CodeMap::from_edits(code.len(), &[]);
        return Ok((code, map));
    }
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &code, source_type).parse();
    if let Some(diagnostic) = parsed.diagnostics.first() {
        return Err(CompilerDiagnostic::from_oxc(
            file_path,
            &code,
            diagnostic,
            "Internal compiler error after source edits: ",
        ));
    }
    let semantic = SemanticBuilder::new_compiler()
        .with_cfg(false)
        .with_build_nodes(false)
        .build(&parsed.program)
        .semantic;
    let mut edits = Vec::new();
    collect_resolved_import_edits(
        &parsed.program,
        semantic.scoping(),
        &code,
        imported_values,
        side_effect_sources,
        consumed_imports,
        &mut edits,
    );
    if edits.is_empty() {
        let map = CodeMap::from_edits(code.len(), &[]);
        return Ok((code, map));
    }
    let edited = apply_edits(file_path, &code, &mut edits)?;
    Ok((edited, CodeMap::from_edits(code.len(), &edits)))
}

/// Theme colors imported from modules with side effects whose value references are all
/// replaced by `edits`, the edited code may no longer load their module
pub(crate) fn consumed_side_effect_imports(
    program: &Program<'_>,
    scoping: &Scoping,
    edits: &[Edit],
    imported_values: &FxHashMap<String, StaticValue>,
    side_effect_sources: &FxHashSet<String>,
) -> FxHashSet<String> {
    if edits.is_empty() || side_effect_sources.is_empty() {
        return FxHashSet::default();
    }
    let mut candidates = FxHashMap::default();
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.import_kind.is_type()
            || !side_effect_sources.contains(declaration.source.value.as_str())
        {
            continue;
        }
        for specifier in declaration.specifiers.iter().flatten() {
            let local = specifier.local();
            if matches!(
                imported_values.get(local.name.as_str()),
                Some(StaticValue::ThemeColors { .. })
            ) && let Some(symbol_id) = local.symbol_id.get()
                && scoping
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_value())
            {
                candidates.insert(symbol_id, (local.name.as_str(), true));
            }
        }
    }
    if candidates.is_empty() {
        return FxHashSet::default();
    }
    let mut visitor = ConsumedReferenceVisitor {
        scoping,
        edits,
        candidates,
    };
    visitor.visit_program(program);
    visitor
        .candidates
        .into_values()
        .filter(|(_, is_consumed)| *is_consumed)
        .map(|(name, _)| name.to_owned())
        .collect()
}

struct ConsumedReferenceVisitor<'s, 'e, 'n> {
    scoping: &'s Scoping,
    edits: &'e [Edit],
    /// Local name and whether every value reference seen so far is inside an edit
    candidates: FxHashMap<SymbolId, (&'n str, bool)>,
}

impl<'a> Visit<'a> for ConsumedReferenceVisitor<'_, '_, '_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let reference = self.scoping.get_reference(identifier.reference_id());
        let Some((_, is_consumed)) = reference
            .symbol_id()
            .and_then(|symbol_id| self.candidates.get_mut(&symbol_id))
        else {
            return;
        };
        if reference.is_value()
            && !self.edits.iter().any(|edit| {
                edit.span.start <= identifier.span.start && identifier.span.end <= edit.span.end
            })
        {
            *is_consumed = false;
        }
    }

    // `typeof colors` in types has no runtime reference
    fn visit_ts_type_query(&mut self, _query: &TSTypeQuery<'a>) {}
}

fn is_runtime_value(value: &StaticValue) -> bool {
    matches!(
        value,
        StaticValue::CyclicImport { .. }
            | StaticValue::MissingImport { .. }
            | StaticValue::UnsupportedReExport { .. }
            | StaticValue::InvalidFunction { .. }
            | StaticValue::InvalidObject { .. }
            | StaticValue::ClassName { .. }
    )
}

fn collect_resolved_import_edits(
    program: &Program<'_>,
    scoping: &Scoping,
    source: &str,
    imported_values: &FxHashMap<String, StaticValue>,
    side_effect_sources: &FxHashSet<String>,
    consumed_imports: &FxHashSet<String>,
    edits: &mut Vec<Edit>,
) {
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.source.value.as_str() == "vindur" {
            continue;
        }
        let Some(specifiers) = &declaration.specifiers else {
            continue;
        };
        let mut compile_time_count = 0usize;
        let has_side_effects = side_effect_sources.contains(declaration.source.value.as_str());
        // The module's CSS and side effects only run while the module itself is imported, so
        // keep it when its keyframes or an inlined class name are still used by this file, or
        // when it has side effects, e.g. global styles, and its theme colors were consumed.
        // Unused imports are not consumed, TypeScript compilers would drop them with the module
        let mut keeps_module = false;
        let mut default_specifier = None;
        let mut namespace_specifier = None;
        let mut runtime_specifiers = Vec::new();
        let mut has_value_specifiers = false;
        let mut has_consumed_values = false;
        for specifier in specifiers {
            has_consumed_values |= consumed_imports.contains(specifier.local().name.as_str());
            let local = match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named) => Some(&named.local),
                ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => Some(&default.local),
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => None,
            };
            let compile_time_value = local.and_then(|local| {
                imported_values
                    .get(local.name.as_str())
                    .filter(|value| !is_runtime_value(value))
                    .filter(|_| {
                        local
                            .symbol_id
                            .get()
                            .is_some_and(|symbol_id| scoping.symbol_is_unused(symbol_id))
                    })
            });
            let Some(value) = compile_time_value else {
                has_value_specifiers |= is_value_specifier(specifier, scoping);
                let span = specifier.span();
                let specifier_source = source[span.start as usize..span.end as usize].to_owned();
                match specifier {
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => {
                        default_specifier = Some(specifier_source);
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => {
                        namespace_specifier = Some(specifier_source);
                    }
                    ImportDeclarationSpecifier::ImportSpecifier(_) => {
                        runtime_specifiers.push(specifier_source);
                    }
                }
                continue;
            };
            compile_time_count += 1;
            keeps_module |= match value {
                StaticValue::Keyframes(_) => true,
                StaticValue::CssClass {
                    name,
                    uses_keyframes,
                    ..
                } => *uses_keyframes || contains_class_name(source, name),
                _ => false,
            };
        }
        keeps_module |= has_side_effects && has_consumed_values;
        if compile_time_count == 0 {
            // Theme colors consumed by vindur styles can leave only type references, e.g.
            // `typeof colors`, TypeScript compilers drop such imports with the module
            if keeps_module && !has_value_specifiers {
                edits.push(Edit {
                    span: declaration.span,
                    replacement: format!(
                        "import \"{}\";\n{}",
                        declaration.source.value,
                        &source[declaration.span.start as usize..declaration.span.end as usize]
                    ),
                });
            }
            continue;
        }
        let has_runtime_specifiers = default_specifier.is_some()
            || namespace_specifier.is_some()
            || !runtime_specifiers.is_empty();
        edits.push(Edit {
            span: if !has_runtime_specifiers && keeps_module {
                declaration.span
            } else {
                expand_removal_to_line(source, declaration.span)
            },
            replacement: if has_runtime_specifiers {
                let rebuilt = rebuilt_import(
                    declaration,
                    source,
                    default_specifier,
                    namespace_specifier,
                    &runtime_specifiers,
                );
                // Type-only and unused specifiers are dropped by TypeScript compilers, which
                // would drop the module too
                if keeps_module && !has_value_specifiers {
                    format!("import \"{}\";\n{rebuilt}", declaration.source.value)
                } else {
                    rebuilt
                }
            } else if keeps_module {
                format!("import \"{}\";", declaration.source.value)
            } else {
                String::new()
            },
        });
    }
}

/// Rebuilds an import declaration with only its runtime specifiers, keeping the default and
/// namespace specifiers, the `import type` kind and any import attributes. A namespace import
/// can't be combined with named ones, so the import only has named specifiers without it
fn rebuilt_import(
    declaration: &ImportDeclaration<'_>,
    source: &str,
    default_specifier: Option<String>,
    namespace_specifier: Option<String>,
    named_specifiers: &[String],
) -> String {
    let kind = if declaration.import_kind.is_type() {
        "type "
    } else {
        ""
    };
    let named = namespace_specifier.or_else(|| {
        (!named_specifiers.is_empty()).then(|| format!("{{ {} }}", named_specifiers.join(", ")))
    });
    let bindings = default_specifier
        .into_iter()
        .chain(named)
        .collect::<Vec<_>>()
        .join(", ");
    let attributes = source[declaration.source.span.end as usize..declaration.span.end as usize]
        .trim()
        .trim_end_matches(';');
    let attributes = if attributes.is_empty() {
        String::new()
    } else {
        format!(" {attributes}")
    };
    format!(
        "import {kind}{bindings} from \"{}\"{attributes};\n",
        declaration.source.value
    )
}

fn is_value_specifier(specifier: &ImportDeclarationSpecifier<'_>, scoping: &Scoping) -> bool {
    if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier
        && specifier.import_kind.is_type()
    {
        return false;
    }
    specifier.local().symbol_id.get().is_some_and(|symbol_id| {
        scoping
            .get_resolved_references(symbol_id)
            .any(|reference| reference.is_value())
    })
}

fn contains_class_name(code: &str, class_name: &str) -> bool {
    code.match_indices(class_name).any(|(index, _)| {
        let is_class_char = |char: char| char.is_ascii_alphanumeric() || matches!(char, '-' | '_');
        let before = code[..index].chars().next_back();
        let after = code[index + class_name.len()..].chars().next();
        !before.is_some_and(is_class_char) && !after.is_some_and(is_class_char)
    })
}
