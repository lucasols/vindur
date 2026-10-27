use oxc_ast::ast::{
    BindingPattern, CallExpression, Declaration, ExportDefaultDeclaration, ExportNamedDeclaration,
    Expression, IdentifierReference, ImportDeclarationSpecifier, JSXAttribute, JSXAttributeName,
    JSXAttributeValue, JSXExpression, ModuleExportName, Program, Statement, TSTypeQuery,
    TaggedTemplateExpression,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use oxc_span::Span;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{CompilerDiagnostic, semantic::VindurImports};

const VINDUR_FN_DECLARATION_ERROR: &str = "vindurFn is not supported here, vindur functions must be declared with \"export const name = vindurFn((...) => ...)\"";

/// vindurFn functions are evaluated at compile time and throw when called at runtime, so
/// they can only be referenced in vindur templates and css props, or exported by the module
/// that declares them.
pub(super) fn runtime_vindur_fn_reference_error(
    program: &Program<'_>,
    scoping: &Scoping,
    imports: &VindurImports<'_>,
    function_names: &FxHashSet<&str>,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let declares_vindur_fn = imports
        .iter_names()
        .any(|(_, imported)| imported == "vindurFn")
        || scoping
            .root_unresolved_references()
            .contains_key("vindurFn");
    if function_names.is_empty() && !declares_vindur_fn {
        return None;
    }
    let mut visitor = RuntimeReferenceVisitor {
        scoping,
        imports,
        function_names,
        declaration_spans: vindur_fn_declaration_spans(program),
        import_sources: import_sources(program),
        first_error: None,
    };
    visitor.visit_program(program);
    let (span, message) = visitor.first_error?;
    Some(CompilerDiagnostic::error(file_path, source, span, message))
}

struct RuntimeReferenceVisitor<'s, 'i, 'n, 'p> {
    scoping: &'s Scoping,
    imports: &'i VindurImports<'i>,
    function_names: &'n FxHashSet<&'n str>,
    declaration_spans: FxHashSet<Span>,
    import_sources: FxHashMap<&'p str, &'p str>,
    first_error: Option<(Span, String)>,
}

impl<'a> Visit<'a> for RuntimeReferenceVisitor<'_, '_, '_, '_> {
    // Direct `vindurFn(...)` callees are not visited, so any other reference is indirect, e.g.
    // `(vindurFn)(...)` or `const create = vindurFn`
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if self.first_error.is_none()
            && self
                .imports
                .matches_import_or_global(identifier, "vindurFn")
        {
            self.first_error = Some((identifier.span, VINDUR_FN_DECLARATION_ERROR.to_owned()));
        }
        if self.first_error.is_none() && self.is_vindur_fn_value_reference(identifier) {
            self.first_error = Some((
                identifier.span,
                format!(
                    "vindurFn \"{name}\" can only be used in vindur style templates (css, styled, keyframes, createGlobalStyle and css prop template literals, e.g. css={{`${{{name}(...)}}`}}), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime",
                    name = identifier.name
                ),
            ));
        }
    }

    // Vindur templates are compiled away or rejected
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

    // Exports keep the function available to other vindur styles, but only named imports of
    // the exported name from the declaring module are resolved
    fn visit_export_named_declaration(&mut self, export: &ExportNamedDeclaration<'a>) {
        if let Some(declaration) = &export.declaration {
            self.visit_declaration(declaration);
        }
        for specifier in &export.specifiers {
            let ModuleExportName::IdentifierReference(local) = &specifier.local else {
                continue;
            };
            if self.first_error.is_some() || !self.is_vindur_fn_value_reference(local) {
                continue;
            }
            let exported = specifier.exported.name();
            if let Some(source) = self.import_sources.get(local.name.as_str()) {
                self.first_error = Some((
                    specifier.span,
                    re_exported_vindur_fn_error(&local.name, source),
                ));
            } else if exported.as_str() != local.name.as_str() {
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
            let message = match self.import_sources.get(identifier.name.as_str()) {
                Some(source) => re_exported_vindur_fn_error(&identifier.name, source),
                None => format!(
                    "vindurFn \"{}\" can't be default exported, vindurFn functions can only be imported by name, use a named export",
                    identifier.name
                ),
            };
            self.first_error = Some((identifier.span, message));
            return;
        }
        walk::walk_export_default_declaration(self, export);
    }

    // vindurFn bodies are checked by the vindurFn validation, which reports a more precise error
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let Expression::Identifier(callee) = &call.callee else {
            walk::walk_call_expression(self, call);
            return;
        };
        if !self.imports.matches_import_or_global(callee, "vindurFn") {
            walk::walk_call_expression(self, call);
            return;
        }
        if self.first_error.is_none() && !self.declaration_spans.contains(&call.span) {
            self.first_error = Some((call.span, VINDUR_FN_DECLARATION_ERROR.to_owned()));
        }
    }

    // `typeof fn` in types has no runtime reference
    fn visit_ts_type_query(&mut self, _query: &TSTypeQuery<'a>) {}
}

impl RuntimeReferenceVisitor<'_, '_, '_, '_> {
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

pub(crate) fn re_exported_vindur_fn_error(name: &str, source: &str) -> String {
    format!(
        "vindurFn \"{name}\" can't be re-exported, vindurFn functions can only be imported from the module that declares them, import it directly from \"{source}\""
    )
}

/// The import sources of the module's imported bindings, by local name
fn import_sources<'a>(program: &Program<'a>) -> FxHashMap<&'a str, &'a str> {
    program
        .body
        .iter()
        .filter_map(|statement| match statement {
            Statement::ImportDeclaration(import) => Some(import),
            _ => None,
        })
        .flat_map(|import| {
            import
                .specifiers
                .iter()
                .flatten()
                .map(move |specifier| (specifier, import.source.value.as_str()))
        })
        .map(|(specifier, source)| {
            let local = match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(specifier) => &specifier.local,
                ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => &specifier.local,
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => &specifier.local,
            };
            (local.name.as_str(), source)
        })
        .collect()
}

/// vindurFn calls initializing module level variables, which are checked by the vindurFn
/// declaration validation, destructured declarations are not supported
fn vindur_fn_declaration_spans(program: &Program<'_>) -> FxHashSet<Span> {
    program
        .body
        .iter()
        .filter_map(|statement| match statement {
            Statement::VariableDeclaration(declaration) => Some(&**declaration),
            Statement::ExportNamedDeclaration(export) => match &export.declaration {
                Some(Declaration::VariableDeclaration(declaration)) => Some(&**declaration),
                _ => None,
            },
            _ => None,
        })
        .flat_map(|declaration| &declaration.declarations)
        .filter(|declarator| matches!(declarator.id, BindingPattern::BindingIdentifier(_)))
        .filter_map(
            |declarator| match declarator.init.as_ref()?.get_inner_expression() {
                Expression::CallExpression(call) => Some(call.span),
                _ => None,
            },
        )
        .collect()
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

/// A tag compiled by vindur: an imported `css`, `keyframes` or `createGlobalStyle`, or `styled`
/// imported or used without importing it. Runtime vindur imports like `cx` aren't template tags
pub(super) fn is_vindur_template_tag(tag: &Expression<'_>, imports: &VindurImports<'_>) -> bool {
    tag_root(tag).is_some_and(|identifier| {
        matches!(
            imports.get_identifier(identifier),
            Some("css" | "keyframes" | "createGlobalStyle")
        ) || imports.matches_import_or_global(identifier, "styled")
    })
}
