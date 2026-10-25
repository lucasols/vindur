use oxc_ast::ast::{
    CallExpression, ExportDefaultDeclaration, ExportNamedDeclaration, Expression,
    IdentifierReference, JSXAttribute, JSXAttributeName, JSXAttributeValue, JSXExpression, Program,
    TSTypeQuery, TaggedTemplateExpression,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::Span;
use rustc_hash::FxHashSet;

use crate::{CompilerDiagnostic, semantic::VindurImports};

/// vindurFn functions are evaluated at compile time and throw when called at runtime, so
/// they can only be referenced in vindur templates and css props, or re-exported.
pub(super) fn runtime_vindur_fn_reference_error(
    program: &Program<'_>,
    scoping: &Scoping,
    imports: &VindurImports<'_>,
    function_names: &FxHashSet<&str>,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    if function_names.is_empty() {
        return None;
    }
    let mut visitor = RuntimeReferenceVisitor {
        scoping,
        imports,
        function_names,
        first_reference: None,
    };
    visitor.visit_program(program);
    let (name, span) = visitor.first_reference?;
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        span,
        format!(
            "vindurFn \"{name}\" can only be used in vindur styles (css, styled, keyframes, createGlobalStyle and the css prop), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime"
        ),
    ))
}

struct RuntimeReferenceVisitor<'s, 'i, 'n> {
    scoping: &'s Scoping,
    imports: &'i VindurImports<'i>,
    function_names: &'n FxHashSet<&'n str>,
    first_reference: Option<(String, Span)>,
}

impl<'a> Visit<'a> for RuntimeReferenceVisitor<'_, '_, '_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if self.first_reference.is_some() || !self.function_names.contains(identifier.name.as_str())
        {
            return;
        }
        let Some(reference_id) = identifier.reference_id.get() else {
            return;
        };
        let Some(symbol_id) = self.scoping.get_reference(reference_id).symbol_id() else {
            return;
        };
        if self.scoping.symbol_scope_id(symbol_id) == self.scoping.root_scope_id() {
            self.first_reference = Some((identifier.name.to_string(), identifier.span));
        }
    }

    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        let is_vindur_template = tag_root(&tagged.tag)
            .is_some_and(|identifier| self.imports.get_identifier(identifier).is_some());
        if is_vindur_template {
            self.visit_runtime_tag_arguments(&tagged.tag);
        } else {
            walk::walk_tagged_template_expression(self, tagged);
        }
    }

    // css prop templates are compiled away like vindur templates, other css prop values are
    // passed through to custom components at runtime
    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        let is_css_prop_template = matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "css")
            && matches!(
                &attribute.value,
                Some(JSXAttributeValue::ExpressionContainer(container))
                    if matches!(container.expression, JSXExpression::TemplateLiteral(_))
            );
        if !is_css_prop_template {
            walk::walk_jsx_attribute(self, attribute);
        }
    }

    // Re-exports keep the function available to other vindur styles
    fn visit_export_named_declaration(&mut self, export: &ExportNamedDeclaration<'a>) {
        if let Some(declaration) = &export.declaration {
            self.visit_declaration(declaration);
        }
    }

    fn visit_export_default_declaration(&mut self, export: &ExportDefaultDeclaration<'a>) {
        let is_identifier = export
            .declaration
            .as_expression()
            .is_some_and(|expression| {
                matches!(expression.get_inner_expression(), Expression::Identifier(_))
            });
        if !is_identifier {
            walk::walk_export_default_declaration(self, export);
        }
    }

    // vindurFn bodies are checked by the vindurFn validation, which reports a more precise error
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let is_vindur_fn = matches!(&call.callee, Expression::Identifier(callee)
            if self.imports.matches_import_or_global(callee, "vindurFn"));
        if !is_vindur_fn {
            walk::walk_call_expression(self, call);
        }
    }

    // `typeof fn` in types has no runtime reference
    fn visit_ts_type_query(&mut self, _query: &TSTypeQuery<'a>) {}
}

impl RuntimeReferenceVisitor<'_, '_, '_> {
    /// Tag call arguments, e.g. the component in `styled(A)` or the `.attrs({})` values, are
    /// kept in the runtime component, unlike the rest of the tag
    fn visit_runtime_tag_arguments(&mut self, tag: &Expression<'_>) {
        match tag {
            Expression::CallExpression(call) => {
                for argument in &call.arguments {
                    self.visit_argument(argument);
                }
                self.visit_runtime_tag_arguments(&call.callee);
            }
            Expression::StaticMemberExpression(member) => {
                self.visit_runtime_tag_arguments(&member.object);
            }
            _ => {}
        }
    }
}

/// The identifier a tag starts with, e.g. `styled` in `styled(A).attrs({})`
fn tag_root<'e, 'a>(expression: &'e Expression<'a>) -> Option<&'e IdentifierReference<'a>> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier),
        Expression::StaticMemberExpression(member) => tag_root(&member.object),
        Expression::CallExpression(call) => tag_root(&call.callee),
        _ => None,
    }
}
