use oxc_ast::ast::{
    CallExpression, ExportDefaultDeclaration, ExportNamedDeclaration, Expression,
    IdentifierReference, JSXAttribute, JSXAttributeName, JSXAttributeValue, JSXExpression,
    ModuleExportName, Program, TSTypeQuery, TaggedTemplateExpression,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::Span;
use rustc_hash::FxHashSet;

use crate::{CompilerDiagnostic, semantic::VindurImports};

/// vindurFn functions are evaluated at compile time and throw when called at runtime, so
/// they can only be referenced in vindur templates and css props, or re-exported by name.
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
        first_error: None,
    };
    visitor.visit_program(program);
    let (span, message) = visitor.first_error?;
    Some(CompilerDiagnostic::error(file_path, source, span, message))
}

struct RuntimeReferenceVisitor<'s, 'i, 'n> {
    scoping: &'s Scoping,
    imports: &'i VindurImports<'i>,
    function_names: &'n FxHashSet<&'n str>,
    first_error: Option<(Span, String)>,
}

impl<'a> Visit<'a> for RuntimeReferenceVisitor<'_, '_, '_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if self.first_error.is_none() && self.is_vindur_fn_value_reference(identifier) {
            self.first_error = Some((
                identifier.span,
                format!(
                    "vindurFn \"{}\" can only be used in vindur styles (css, styled, keyframes, createGlobalStyle and the css prop), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime",
                    identifier.name
                ),
            ));
        }
    }

    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if is_vindur_template_tag(&tagged.tag, self.imports) {
            self.visit_runtime_tag_arguments(&tagged.tag);
        } else {
            walk::walk_tagged_template_expression(self, tagged);
        }
    }

    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        if !is_css_template_attribute(attribute) {
            walk::walk_jsx_attribute(self, attribute);
        }
    }

    // Re-exports keep the function available to other vindur styles, but only named imports
    // of the exported name are resolved
    fn visit_export_named_declaration(&mut self, export: &ExportNamedDeclaration<'a>) {
        if let Some(declaration) = &export.declaration {
            self.visit_declaration(declaration);
        }
        for specifier in &export.specifiers {
            let ModuleExportName::IdentifierReference(local) = &specifier.local else {
                continue;
            };
            let exported = specifier.exported.name();
            if self.first_error.is_none()
                && exported.as_str() != local.name.as_str()
                && self.is_vindur_fn_value_reference(local)
            {
                self.first_error = Some((
                    specifier.span,
                    format!(
                        "vindurFn \"{}\" can't be exported as \"{exported}\", vindurFn functions can only be exported with their own name",
                        local.name
                    ),
                ));
            }
        }
    }

    fn visit_export_default_declaration(&mut self, export: &ExportDefaultDeclaration<'a>) {
        if let Some(Expression::Identifier(identifier)) = export
            .declaration
            .as_expression()
            .map(Expression::get_inner_expression)
            && self.first_error.is_none()
            && self.is_vindur_fn_value_reference(identifier)
        {
            self.first_error = Some((
                identifier.span,
                format!(
                    "vindurFn \"{}\" can't be default exported, vindurFn functions can only be imported by name, use a named export",
                    identifier.name
                ),
            ));
            return;
        }
        walk::walk_export_default_declaration(self, export);
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
    /// A value reference to a module level vindurFn, shadowing bindings and types are ignored
    fn is_vindur_fn_value_reference(&self, identifier: &IdentifierReference<'_>) -> bool {
        if !self.function_names.contains(identifier.name.as_str()) {
            return false;
        }
        let Some(reference_id) = identifier.reference_id.get() else {
            return false;
        };
        let reference = self.scoping.get_reference(reference_id);
        if !reference.is_value() {
            return false;
        }
        reference.symbol_id().is_some_and(|symbol_id| {
            self.scoping.symbol_scope_id(symbol_id) == self.scoping.root_scope_id()
        })
    }

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
pub(super) fn tag_root<'e, 'a>(
    expression: &'e Expression<'a>,
) -> Option<&'e IdentifierReference<'a>> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier),
        Expression::StaticMemberExpression(member) => tag_root(&member.object),
        Expression::CallExpression(call) => tag_root(&call.callee),
        _ => None,
    }
}

/// css prop templates are compiled away like vindur templates, other css prop values are
/// passed through to custom components at runtime
pub(super) fn is_css_template_attribute(attribute: &JSXAttribute<'_>) -> bool {
    matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "css")
        && matches!(
            &attribute.value,
            Some(JSXAttributeValue::ExpressionContainer(container))
                if matches!(container.expression, JSXExpression::TemplateLiteral(_))
        )
}

/// A tag starting with `styled`, e.g. `styled.div`, `styled(A)` or `styled.div.attrs({})`
pub(super) fn is_styled_tag(tag: &Expression<'_>, imports: &VindurImports<'_>) -> bool {
    tag_root(tag).is_some_and(|identifier| imports.matches_import_or_global(identifier, "styled"))
}

/// A tag compiled by vindur: a vindur import, or `styled` used without importing it
pub(super) fn is_vindur_template_tag(tag: &Expression<'_>, imports: &VindurImports<'_>) -> bool {
    tag_root(tag).is_some_and(|identifier| {
        imports.get_identifier(identifier).is_some()
            || imports.matches_import_or_global(identifier, "styled")
    })
}
