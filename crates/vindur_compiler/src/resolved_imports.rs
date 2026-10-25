use oxc_allocator::Allocator;
use oxc_ast::ast::{ImportDeclarationSpecifier, Program, Statement};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_span::{GetSpan, SourceType};
use rustc_hash::FxHashMap;

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
) -> Result<String, CompilerDiagnostic> {
    if imported_values.is_empty() {
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
        StaticValue::MissingImport { .. }
            | StaticValue::InvalidFunction { .. }
            | StaticValue::InvalidObject { .. }
            | StaticValue::ClassName(_)
            | StaticValue::ThemeColors(_)
    )
}

fn collect_resolved_import_edits(
    program: &Program<'_>,
    scoping: &Scoping,
    source: &str,
    imported_values: &FxHashMap<String, StaticValue>,
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
        let mut has_keyframes = false;
        let mut runtime_specifiers = Vec::new();
        for specifier in specifiers {
            let compile_time_value = match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named) => imported_values
                    .get(named.local.name.as_str())
                    .filter(|value| !is_runtime_value(value))
                    .filter(|_| {
                        named
                            .local
                            .symbol_id
                            .get()
                            .is_some_and(|symbol_id| scoping.symbol_is_unused(symbol_id))
                    }),
                _ => None,
            };
            let Some(value) = compile_time_value else {
                let span = specifier.span();
                runtime_specifiers.push(source[span.start as usize..span.end as usize].to_owned());
                continue;
            };
            compile_time_count += 1;
            has_keyframes |= matches!(value, StaticValue::Keyframes(_));
        }
        if compile_time_count == 0 {
            continue;
        }
        edits.push(Edit {
            span: if runtime_specifiers.is_empty() && has_keyframes {
                declaration.span
            } else {
                expand_removal_to_line(source, declaration.span)
            },
            replacement: if !runtime_specifiers.is_empty() {
                format!(
                    "import {{ {} }} from \"{}\";\n",
                    runtime_specifiers.join(", "),
                    declaration.source.value
                )
            } else if has_keyframes {
                format!("import \"{}\";", declaration.source.value)
            } else {
                String::new()
            },
        });
    }
}
