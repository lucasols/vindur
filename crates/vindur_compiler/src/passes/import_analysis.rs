use oxc_ast::ast::{BindingPattern, Expression, ImportDeclarationSpecifier, Program, Statement};
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    diagnostic::CompilerDiagnostic,
    edit::{Edit, expand_removal_to_line},
    semantic::VindurImports,
};

const COMPILE_TIME_IMPORTS: &[&str] = &[
    "css",
    "createClassName",
    "createGlobalStyle",
    "keyframes",
    "layer",
    "stableId",
    "styled",
];

pub(super) fn is_compile_time_import(name: &str) -> bool {
    COMPILE_TIME_IMPORTS.contains(&name)
}

/// Local bindings keyed by the name they are exported as
pub(super) fn collect_exported_names(program: &Program<'_>) -> FxHashMap<String, String> {
    let mut names = FxHashMap::default();
    for statement in &program.body {
        match statement {
            Statement::ExportNamedDeclaration(export) => {
                if let Some(oxc_ast::ast::Declaration::VariableDeclaration(declaration)) =
                    &export.declaration
                {
                    names.extend(declaration.declarations.iter().filter_map(|declarator| {
                        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                            return None;
                        };
                        Some((identifier.name.to_string(), identifier.name.to_string()))
                    }));
                } else if let Some(name) = export.declaration.as_ref().and_then(declared_value_name)
                {
                    names.insert(name.clone(), name);
                } else if export.source.is_none() {
                    names.extend(export.specifiers.iter().map(|specifier| {
                        (
                            specifier.exported.name().to_string(),
                            specifier.local.name().to_string(),
                        )
                    }));
                }
            }
            Statement::ExportDefaultDeclaration(export) => {
                if let oxc_ast::ast::ExportDefaultDeclarationKind::Identifier(identifier) =
                    &export.declaration
                {
                    names.insert("default".to_owned(), identifier.name.to_string());
                }
            }
            _ => {}
        }
    }
    names
}

/// Name of an exported function, class or enum, they are never static values
fn declared_value_name(declaration: &oxc_ast::ast::Declaration<'_>) -> Option<String> {
    match declaration {
        oxc_ast::ast::Declaration::FunctionDeclaration(function) => {
            function.id.as_ref().map(|id| id.name.to_string())
        }
        oxc_ast::ast::Declaration::ClassDeclaration(class) => {
            class.id.as_ref().map(|id| id.name.to_string())
        }
        oxc_ast::ast::Declaration::TSEnumDeclaration(declaration) => {
            Some(declaration.id.name.to_string())
        }
        _ => None,
    }
}

/// `export { name } from 'source'` names keyed by exported name, and `export * from` sources
pub(super) fn collect_re_exports(
    program: &Program<'_>,
) -> (FxHashMap<String, String>, Vec<String>) {
    let mut names = FxHashMap::default();
    let mut star_sources = Vec::new();
    for statement in &program.body {
        match statement {
            Statement::ExportNamedDeclaration(export) => {
                let Some(export_source) = &export.source else {
                    continue;
                };
                names.extend(export.specifiers.iter().map(|specifier| {
                    (
                        specifier.exported.name().to_string(),
                        export_source.value.to_string(),
                    )
                }));
            }
            Statement::ExportAllDeclaration(export) => {
                if let Some(exported) = &export.exported {
                    names.insert(exported.name().to_string(), export.source.value.to_string());
                } else {
                    star_sources.push(export.source.value.to_string());
                }
            }
            _ => {}
        }
    }
    (names, star_sources)
}

pub(super) fn collect_exported_object_names(program: &Program<'_>) -> FxHashSet<String> {
    program
        .body
        .iter()
        .filter_map(|statement| {
            let Statement::ExportNamedDeclaration(export) = statement else {
                return None;
            };
            let Some(oxc_ast::ast::Declaration::VariableDeclaration(declaration)) =
                &export.declaration
            else {
                return None;
            };
            Some(declaration)
        })
        .flat_map(|declaration| &declaration.declarations)
        .filter_map(|declarator| {
            if !matches!(declarator.init, Some(Expression::ObjectExpression(_))) {
                return None;
            }
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                return None;
            };
            Some(identifier.name.to_string())
        })
        .collect()
}

pub(super) fn assigned_tag_spans(program: &Program<'_>) -> Vec<oxc_span::Span> {
    let mut spans = Vec::new();
    for statement in &program.body {
        let declaration = match statement {
            Statement::VariableDeclaration(declaration) => Some(declaration),
            Statement::ExportNamedDeclaration(export) => match &export.declaration {
                Some(oxc_ast::ast::Declaration::VariableDeclaration(declaration)) => {
                    Some(declaration)
                }
                _ => None,
            },
            _ => None,
        };
        let Some(declaration) = declaration else {
            continue;
        };
        spans.extend(declaration.declarations.iter().filter_map(|declarator| {
            let Some(Expression::TaggedTemplateExpression(tagged)) = &declarator.init else {
                return None;
            };
            Some(tagged.span)
        }));
    }
    spans
}

fn unsupported_import_kind(specifier: &ImportDeclarationSpecifier<'_>) -> Option<&'static str> {
    match specifier {
        ImportDeclarationSpecifier::ImportSpecifier(_) => None,
        ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => Some("default"),
        ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => Some("namespace"),
    }
}

pub(super) fn collect_vindur_imports(
    program: &Program<'_>,
    file_path: &str,
    source: &str,
    imports: &mut VindurImports<'_>,
    edits: &mut Vec<Edit>,
) -> Result<(), CompilerDiagnostic> {
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.source.value.as_str() != "vindur" {
            continue;
        }

        let mut compile_time_count = 0usize;
        let mut specifier_count = 0usize;
        let mut runtime_specifiers = Vec::new();
        if let Some(specifiers) = &declaration.specifiers {
            for specifier in specifiers {
                specifier_count += 1;
                if !declaration.import_kind.is_type()
                    && let Some(kind) = unsupported_import_kind(specifier)
                {
                    return Err(CompilerDiagnostic::error(
                        file_path,
                        source,
                        specifier.span(),
                        format!(
                            "{kind} vindur imports are not supported, import the names you use, eg. import {{ styled }} from \"vindur\""
                        ),
                    ));
                }
                if let ImportDeclarationSpecifier::ImportSpecifier(named) = specifier {
                    let imported = named.imported.name();
                    let is_type_import =
                        declaration.import_kind.is_type() || named.import_kind.is_type();
                    if !is_type_import && imported.as_str() != named.local.name.as_str() {
                        return Err(CompilerDiagnostic::error(
                            file_path,
                            source,
                            named.span,
                            format!(
                                "aliased vindur imports are not supported, import \"{imported}\" without the \"{}\" alias",
                                named.local.name
                            ),
                        ));
                    }
                    // Runtime imports are tracked too, so vindur utilities are detected by
                    // their import instead of their name
                    imports.insert(&named.local, imported.as_str());
                    if is_compile_time_import(imported.as_str()) {
                        compile_time_count += 1;
                        continue;
                    }
                }
                let span = specifier.span();
                runtime_specifiers.push(source[span.start as usize..span.end as usize].to_owned());
            }
        }

        if compile_time_count == 0 {
            continue;
        }
        if compile_time_count == specifier_count {
            edits.push(Edit {
                span: expand_removal_to_line(source, declaration.span),
                replacement: String::new(),
            });
        } else {
            edits.push(Edit {
                span: declaration.span,
                replacement: format!(
                    "import {{ {} }} from \"vindur\";",
                    runtime_specifiers.join(", ")
                ),
            });
        }
    }
    Ok(())
}
