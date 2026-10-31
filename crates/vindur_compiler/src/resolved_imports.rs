use oxc_allocator::Allocator;
use oxc_ast::ast::{ImportDeclaration, ImportDeclarationSpecifier, Program, Statement};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder};
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
) -> Result<String, CompilerDiagnostic> {
    if !imported_values
        .values()
        .any(|value| !is_runtime_value(value))
    {
        return Ok(code);
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
        &mut edits,
    );
    if edits.is_empty() {
        return Ok(code);
    }
    apply_edits(file_path, &code, &mut edits)
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
        // The module's CSS and side effects only run while the module itself is imported, so
        // keep it when it has side effects, e.g. global styles, or when its keyframes or an
        // inlined class name are still used by this file
        let mut keeps_module = side_effect_sources.contains(declaration.source.value.as_str());
        let mut default_specifier = None;
        let mut runtime_specifiers = Vec::new();
        for specifier in specifiers {
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
                let span = specifier.span();
                let specifier_source = source[span.start as usize..span.end as usize].to_owned();
                if matches!(
                    specifier,
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(_)
                ) {
                    default_specifier = Some(specifier_source);
                } else {
                    runtime_specifiers.push(specifier_source);
                }
                continue;
            };
            compile_time_count += 1;
            keeps_module |= match value {
                StaticValue::Keyframes(_) => true,
                StaticValue::CssClass { name, .. } => contains_class_name(source, name),
                _ => false,
            };
        }
        if compile_time_count == 0 {
            continue;
        }
        let has_runtime_specifiers = default_specifier.is_some() || !runtime_specifiers.is_empty();
        edits.push(Edit {
            span: if !has_runtime_specifiers && keeps_module {
                declaration.span
            } else {
                expand_removal_to_line(source, declaration.span)
            },
            replacement: if has_runtime_specifiers {
                rebuilt_import(declaration, source, default_specifier, &runtime_specifiers)
            } else if keeps_module {
                format!("import \"{}\";", declaration.source.value)
            } else {
                String::new()
            },
        });
    }
}

/// Rebuilds an import declaration with only its runtime specifiers, keeping the default
/// specifier, the `import type` kind and any import attributes
fn rebuilt_import(
    declaration: &ImportDeclaration<'_>,
    source: &str,
    default_specifier: Option<String>,
    named_specifiers: &[String],
) -> String {
    let kind = if declaration.import_kind.is_type() {
        "type "
    } else {
        ""
    };
    let named =
        (!named_specifiers.is_empty()).then(|| format!("{{ {} }}", named_specifiers.join(", ")));
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

fn contains_class_name(code: &str, class_name: &str) -> bool {
    code.match_indices(class_name).any(|(index, _)| {
        let is_class_char = |char: char| char.is_ascii_alphanumeric() || matches!(char, '-' | '_');
        let before = code[..index].chars().next_back();
        let after = code[index + class_name.len()..].chars().next();
        !before.is_some_and(is_class_char) && !after.is_some_and(is_class_char)
    })
}
