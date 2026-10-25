use oxc_ast::ast::{BindingPattern, Expression, ImportDeclarationSpecifier, Program, Statement};
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{
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

pub(super) fn collect_exported_names(program: &Program<'_>) -> FxHashSet<String> {
    let mut names = FxHashSet::default();
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
                        Some(identifier.name.to_string())
                    }));
                } else {
                    names.extend(
                        export
                            .specifiers
                            .iter()
                            .map(|specifier| specifier.local.name().to_string()),
                    );
                }
            }
            Statement::ExportDefaultDeclaration(export) => {
                if let oxc_ast::ast::ExportDefaultDeclarationKind::Identifier(identifier) =
                    &export.declaration
                {
                    names.insert(identifier.name.to_string());
                }
            }
            _ => {}
        }
    }
    names
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

pub(super) fn collect_vindur_imports(
    program: &Program<'_>,
    source: &str,
    imports: &mut VindurImports<'_>,
    edits: &mut Vec<Edit>,
) {
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
                if let ImportDeclarationSpecifier::ImportSpecifier(named) = specifier {
                    let imported = named.imported.name();
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
}
