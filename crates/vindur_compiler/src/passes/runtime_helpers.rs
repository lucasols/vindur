use oxc_ast::ast::{ImportDeclarationSpecifier, Program, Statement};
use oxc_semantic::Scoping;

use crate::{CompilerDiagnostic, edit::Edit};

/// The import of the vindur helpers that generated code calls by their own names, e.g.
/// `cx(...)` for a cx prop. A helper the file already imports under its own name is reused
pub(super) fn runtime_helpers_import(
    program: &Program<'_>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
    helpers: &[&str],
) -> Result<Option<Edit>, CompilerDiagnostic> {
    let mut missing = Vec::new();
    for helper in helpers {
        if has_named_vindur_import(program, helper) {
            continue;
        }
        if let Some(symbol_id) = scoping.get_root_binding((*helper).into()) {
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                scoping.symbol_span(symbol_id),
                format!(
                    "`{helper}` is already declared in this file, but the code vindur generates calls the `{helper}` from vindur. Rename this binding"
                ),
            ));
        }
        missing.push(*helper);
    }
    if missing.is_empty() {
        return Ok(None);
    }
    let quote = vindur_import_quote(program, source);
    Ok(Some(Edit {
        span: oxc_span::Span::new(0, 0),
        replacement: format!(
            "import {{ {} }} from {quote}vindur{quote};\n",
            missing.join(", "),
        ),
    }))
}

/// Whether `name` is imported from vindur under its own name, an alias like
/// `cx as classes` doesn't bind the `cx` that generated code calls
pub(super) fn has_named_vindur_import(program: &Program<'_>, name: &str) -> bool {
    program.body.iter().any(|statement| {
        let Statement::ImportDeclaration(import) = statement else {
            return false;
        };
        if import.source.value.as_str() != "vindur" {
            return false;
        }
        import.specifiers.as_ref().is_some_and(|specifiers| {
            specifiers.iter().any(|specifier| {
                let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                    return false;
                };
                specifier.imported.name().as_str() == name && specifier.local.name.as_str() == name
            })
        })
    })
}

fn vindur_import_quote(program: &Program<'_>, source: &str) -> char {
    program
        .body
        .iter()
        .find_map(|statement| {
            let Statement::ImportDeclaration(import) = statement else {
                return None;
            };
            if import.source.value.as_str() != "vindur" {
                return None;
            }
            source
                .as_bytes()
                .get(import.source.span.start as usize)
                .copied()
                .map(char::from)
        })
        .filter(|quote| matches!(quote, '\'' | '"'))
        .unwrap_or('"')
}
