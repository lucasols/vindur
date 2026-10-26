use oxc_ast::ast::{
    CallExpression, Declaration, Expression, IdentifierReference, JSXAttribute, JSXAttributeItem,
    JSXAttributeName, JSXAttributeValue, JSXClosingElement, JSXElementName, JSXExpression,
    JSXOpeningElement, Program, Statement, TSTypeQuery, TaggedTemplateExpression,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{Scoping, SymbolId};
use oxc_span::Span;
use rustc_hash::FxHashSet;

use crate::{CompilerDiagnostic, semantic::VindurImports};

use super::vindur_fn_references::tag_root;

/// Top level bindings referenced as values, e.g. `const El = cond ? A : B` or
/// `<Menu button={A} />`. References as JSX element names, in vindur templates and
/// css prop templates (`${A}` selectors, `styled(A)`) and in `A.withComponent()` are compiled
/// away, so they are not included. Styled components referenced as values must be kept as
/// runtime components.
///
/// `withComponent()` is only compiled as the initializer of a top-level variable, any other
/// call on a local binding is an error.
pub(super) fn collect_value_referenced_names(
    program: &Program<'_>,
    scoping: &Scoping,
    imports: &VindurImports<'_>,
    file_path: &str,
    source: &str,
) -> Result<FxHashSet<String>, CompilerDiagnostic> {
    let mut visitor = ValueReferenceVisitor {
        scoping,
        imports,
        top_level_with_component_calls: top_level_with_component_calls(program),
        names: FxHashSet::default(),
        first_error: None,
    };
    visitor.visit_program(program);
    match visitor.first_error {
        Some((span, message)) => Err(CompilerDiagnostic::error(file_path, source, span, message)),
        None => Ok(visitor.names),
    }
}

struct ValueReferenceVisitor<'s, 'i> {
    scoping: &'s Scoping,
    imports: &'i VindurImports<'i>,
    /// Span starts of the `withComponent()` calls compiled by `process_with_component`
    top_level_with_component_calls: FxHashSet<u32>,
    names: FxHashSet<String>,
    first_error: Option<(Span, String)>,
}

impl<'a> Visit<'a> for ValueReferenceVisitor<'_, '_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if self.top_level_symbol(identifier).is_some() {
            self.names.insert(identifier.name.to_string());
        }
    }

    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        if !matches!(element.name, JSXElementName::IdentifierReference(_)) {
            self.visit_jsx_element_name(&element.name);
        }
        for attribute in &element.attributes {
            match attribute {
                // The css prop template is compiled away like vindur templates
                JSXAttributeItem::Attribute(attribute) if is_css_template_attribute(attribute) => {}
                JSXAttributeItem::Attribute(attribute) => self.visit_jsx_attribute(attribute),
                JSXAttributeItem::SpreadAttribute(spread) => {
                    self.visit_jsx_spread_attribute(spread);
                }
            }
        }
    }

    fn visit_jsx_closing_element(&mut self, element: &JSXClosingElement<'a>) {
        if !matches!(element.name, JSXElementName::IdentifierReference(_)) {
            self.visit_jsx_element_name(&element.name);
        }
    }

    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        let is_vindur_template = tag_root(&tagged.tag).is_some_and(|identifier| {
            self.imports.get_identifier(identifier).is_some()
                || self.imports.matches_import_or_global(identifier, "styled")
        });
        if is_vindur_template {
            self.visit_attrs_arguments(&tagged.tag);
        } else {
            walk::walk_tagged_template_expression(self, tagged);
        }
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(member) = &call.callee
            && member.property.name.as_str() == "withComponent"
            && let Expression::Identifier(base) = &member.object
        {
            if self.first_error.is_none()
                && !self
                    .top_level_with_component_calls
                    .contains(&call.span.start)
                && self
                    .top_level_symbol(base)
                    .is_some_and(|symbol_id| !self.scoping.symbol_flags(symbol_id).is_import())
            {
                self.first_error = Some((
                    call.span,
                    format!(
                        "\"{name}.withComponent()\" must be the initializer of a top-level variable, e.g. `const Link = {name}.withComponent('a')`",
                        name = base.name
                    ),
                ));
            }
            for argument in &call.arguments {
                self.visit_argument(argument);
            }
            return;
        }
        walk::walk_call_expression(self, call);
    }

    // `typeof A` in types has no runtime reference
    fn visit_ts_type_query(&mut self, _query: &TSTypeQuery<'a>) {}
}

impl ValueReferenceVisitor<'_, '_> {
    fn top_level_symbol(&self, identifier: &IdentifierReference<'_>) -> Option<SymbolId> {
        identifier
            .reference_id
            .get()
            .and_then(|reference_id| self.scoping.get_reference(reference_id).symbol_id())
            .filter(|symbol_id| {
                self.scoping.symbol_scope_id(*symbol_id) == self.scoping.root_scope_id()
            })
    }

    /// `.attrs()` objects are kept in the runtime output, the rest of the tag is compiled away
    fn visit_attrs_arguments(&mut self, tag: &Expression<'_>) {
        match tag {
            Expression::CallExpression(call) => {
                if let Expression::StaticMemberExpression(member) = &call.callee
                    && member.property.name.as_str() == "attrs"
                {
                    for argument in &call.arguments {
                        self.visit_argument(argument);
                    }
                }
                self.visit_attrs_arguments(&call.callee);
            }
            Expression::StaticMemberExpression(member) => {
                self.visit_attrs_arguments(&member.object);
            }
            _ => {}
        }
    }
}

/// Other `css` values on custom components are passed through as the component's own prop
fn is_css_template_attribute(attribute: &JSXAttribute<'_>) -> bool {
    matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "css")
        && matches!(
            &attribute.value,
            Some(JSXAttributeValue::ExpressionContainer(container))
                if matches!(container.expression, JSXExpression::TemplateLiteral(_))
        )
}

fn top_level_with_component_calls(program: &Program<'_>) -> FxHashSet<u32> {
    let mut calls = FxHashSet::default();
    for statement in &program.body {
        let declaration = match statement {
            Statement::VariableDeclaration(declaration) => declaration,
            Statement::ExportNamedDeclaration(export) => {
                let Some(Declaration::VariableDeclaration(declaration)) = &export.declaration
                else {
                    continue;
                };
                declaration
            }
            _ => continue,
        };
        for declarator in &declaration.declarations {
            if let Some(Expression::CallExpression(call)) = &declarator.init
                && let Expression::StaticMemberExpression(member) = &call.callee
                && member.property.name.as_str() == "withComponent"
            {
                calls.insert(call.span.start);
            }
        }
    }
    calls
}
