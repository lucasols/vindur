use oxc_ast::ast::{BindingPattern, CallExpression, Expression, Program, VariableDeclaration};
use oxc_ast_visit::{Visit, walk};
use oxc_span::Span;
use oxc_syntax::scope::ScopeFlags;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, edit::Edit, facts::StaticValue, semantic::VindurImports};

pub(crate) struct StableDeclarationTransform<'a> {
    pub imports: &'a VindurImports<'a>,
    pub constants: &'a mut FxHashMap<String, StaticValue>,
    pub file_hash: &'a str,
    pub file_path: &'a str,
    pub source: &'a str,
    pub id_index: &'a mut u32,
    pub edits: &'a mut Vec<Edit>,
    pub handled_calls: &'a mut Vec<Span>,
}

pub(crate) fn transform_stable_declaration(
    declaration: &VariableDeclaration<'_>,
    context: &mut StableDeclarationTransform<'_>,
) -> Result<(), CompilerDiagnostic> {
    for declarator in &declaration.declarations {
        let Some(Expression::CallExpression(call)) = &declarator.init else {
            continue;
        };
        let Some(utility) = imported_utility(call, context.imports) else {
            continue;
        };
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            return Err(CompilerDiagnostic::error(
                context.file_path,
                context.source,
                call.span,
                format!(
                    "{utility}() cannot be used with destructuring assignment. Use a regular variable assignment instead."
                ),
            ));
        };
        let variable_name = identifier.name.as_str();
        let generated = format!("{}-{variable_name}-{}", context.file_hash, context.id_index);
        *context.id_index += 1;
        let replacement = if utility == "stableId" {
            context.constants.insert(
                variable_name.to_owned(),
                StaticValue::String(generated.clone()),
            );
            format!("\"{generated}\"")
        } else {
            context.constants.insert(
                variable_name.to_owned(),
                StaticValue::ClassName(generated.clone()),
            );
            let Expression::Identifier(callee) = &call.callee else {
                continue;
            };
            format!("{}(\"{generated}\")", callee.name)
        };
        context.edits.push(Edit {
            span: call.span,
            replacement,
        });
        context.handled_calls.push(call.span);
    }
    Ok(())
}

pub(crate) struct StableInlineTransform<'a> {
    pub imports: &'a VindurImports<'a>,
    pub handled_calls: &'a [Span],
    pub file_hash: &'a str,
    pub file_path: &'a str,
    pub source: &'a str,
    pub id_index: &'a mut u32,
    pub edits: &'a mut Vec<Edit>,
}

pub(crate) fn transform_inline_stable_calls(
    program: &Program<'_>,
    output: StableInlineTransform<'_>,
) -> Result<(), CompilerDiagnostic> {
    let mut visitor = StableCallVisitor {
        output,
        function_depth: 0,
        diagnostic: None,
    };
    visitor.visit_program(program);
    match visitor.diagnostic {
        Some(diagnostic) => Err(diagnostic),
        None => Ok(()),
    }
}

struct StableCallVisitor<'a> {
    output: StableInlineTransform<'a>,
    function_depth: u32,
    diagnostic: Option<CompilerDiagnostic>,
}

impl<'a> Visit<'a> for StableCallVisitor<'_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.diagnostic.is_some() || self.output.handled_calls.contains(&call.span) {
            return;
        }
        let Some(utility) = imported_utility(call, self.output.imports) else {
            walk::walk_call_expression(self, call);
            return;
        };
        if utility == "createClassName" {
            let message = if self.function_depth > 0 {
                "createClassName() can only be used in variable declarations at the module root level."
            } else {
                "createClassName() can only be used in variable declarations at the module root level, not inline."
            };
            self.diagnostic = Some(CompilerDiagnostic::error(
                self.output.file_path,
                self.output.source,
                call.span,
                message.to_owned(),
            ));
            return;
        }

        let generated = format!("{}-{}", self.output.file_hash, self.output.id_index);
        *self.output.id_index += 1;
        self.output.edits.push(Edit {
            span: call.span,
            replacement: format!("\"{generated}\""),
        });
    }

    fn visit_function(&mut self, function: &oxc_ast::ast::Function<'a>, flags: ScopeFlags) {
        self.function_depth += 1;
        walk::walk_function(self, function, flags);
        self.function_depth -= 1;
    }

    fn visit_arrow_function_expression(
        &mut self,
        function: &oxc_ast::ast::ArrowFunctionExpression<'a>,
    ) {
        self.function_depth += 1;
        walk::walk_arrow_function_expression(self, function);
        self.function_depth -= 1;
    }
}

fn imported_utility<'a>(
    call: &CallExpression<'_>,
    imports: &'a VindurImports<'_>,
) -> Option<&'a str> {
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    let utility = imports.get_identifier(callee)?;
    matches!(utility, "stableId" | "createClassName").then_some(utility)
}
