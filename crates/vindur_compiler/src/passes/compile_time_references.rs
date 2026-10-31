use oxc_ast::ast::{IdentifierReference, Program, TSTypeQuery};
use oxc_ast_visit::Visit;
use oxc_semantic::Scoping;
use oxc_span::Span;

use crate::{CompilerDiagnostic, edit::Edit, semantic::VindurImports};

use super::import_analysis::is_compile_time_import;

/// Compile-time vindur imports are removed from the output, so every reference to them has
/// to be replaced by an edit, references in unsupported positions would be left unbound
pub(super) fn uncompiled_reference_error(
    program: &Program<'_>,
    scoping: &Scoping,
    imports: &VindurImports<'_>,
    edits: &[Edit],
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let mut visitor = UncompiledReferenceVisitor {
        scoping,
        imports,
        edits,
        first_error: None,
    };
    visitor.visit_program(program);
    visitor.first_error.map(|(span, name)| {
        CompilerDiagnostic::error(file_path, source, span, uncompiled_message(&name))
    })
}

fn uncompiled_message(name: &str) -> String {
    let usage = match name {
        "createGlobalStyle" => {
            "use it as a top-level statement or const declaration, eg. createGlobalStyle`body { margin: 0; }`"
        }
        "layer" => "use it inside a vindur style, eg. ${layer('base')} { color: red; }",
        "stableId" => "use it in a top-level const declaration, eg. const id = stableId()",
        _ => "use it in a top-level const declaration or in a style prop",
    };
    format!("vindur's \"{name}\" is compiled away and can't be used here, {usage}")
}

struct UncompiledReferenceVisitor<'s, 'i, 'e> {
    scoping: &'s Scoping,
    imports: &'i VindurImports<'i>,
    edits: &'e [Edit],
    first_error: Option<(Span, String)>,
}

impl<'a> Visit<'a> for UncompiledReferenceVisitor<'_, '_, '_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if self.first_error.is_some() {
            return;
        }
        let Some(name) = self
            .imports
            .get_identifier(identifier)
            .filter(|name| is_compile_time_import(name))
        else {
            return;
        };
        let is_value = self
            .scoping
            .get_reference(identifier.reference_id())
            .is_value();
        let is_replaced = self.edits.iter().any(|edit| {
            edit.span.start <= identifier.span.start && identifier.span.end <= edit.span.end
        });
        if is_value && !is_replaced {
            self.first_error = Some((identifier.span, name.to_owned()));
        }
    }

    // `typeof css` in types has no runtime reference
    fn visit_ts_type_query(&mut self, _query: &TSTypeQuery<'a>) {}
}
