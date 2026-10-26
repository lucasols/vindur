use oxc_ast::ast::{CallExpression, Expression, IdentifierReference, Program, TSTypeQuery};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{Scoping, SymbolId};
use oxc_span::Span;

use crate::CompilerDiagnostic;

use super::cx_optimize::vindur_cx_symbols;

/// vindur's `cx` is only supported as a direct call, so every call can be optimized at
/// compile time and the import removed
pub(super) fn non_call_cx_reference_error(
    program: &Program<'_>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let cx_symbols = vindur_cx_symbols(program);
    if cx_symbols.is_empty() {
        return None;
    }
    let mut visitor = NonCallReferenceVisitor {
        scoping,
        cx_symbols: &cx_symbols,
        first_error: None,
    };
    visitor.visit_program(program);
    visitor
        .first_error
        .map(|span| CompilerDiagnostic::error(file_path, source, span, non_call_message()))
}

fn non_call_message() -> String {
    "vindur's \"cx\" can only be called directly, eg. cx(\"base\", { active: isActive }), other references to it are not supported".to_owned()
}

struct NonCallReferenceVisitor<'s, 'c> {
    scoping: &'s Scoping,
    cx_symbols: &'c [SymbolId],
    first_error: Option<Span>,
}

impl<'a> Visit<'a> for NonCallReferenceVisitor<'_, '_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if self.first_error.is_some() {
            return;
        }
        let reference = self.scoping.get_reference(identifier.reference_id());
        if reference.is_value()
            && reference
                .symbol_id()
                .is_some_and(|symbol| self.cx_symbols.contains(&symbol))
        {
            self.first_error = Some(identifier.span);
        }
    }

    // A direct call is the supported use, only its arguments can hold other references
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if matches!(call.callee, Expression::Identifier(_)) {
            for argument in &call.arguments {
                self.visit_argument(argument);
            }
        } else {
            walk::walk_call_expression(self, call);
        }
    }

    // `typeof cx` in types has no runtime reference
    fn visit_ts_type_query(&mut self, _query: &TSTypeQuery<'a>) {}
}
