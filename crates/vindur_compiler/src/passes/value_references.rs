use oxc_ast::ast::{
    BindingPattern, CallExpression, Declaration, Expression, IdentifierReference, JSXAttributeItem,
    JSXClosingElement, JSXElementName, JSXOpeningElement, Program, Statement, TSTypeQuery,
    TaggedTemplateExpression,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{Scoping, SymbolId};
use oxc_span::Span;
use rustc_hash::FxHashSet;

use crate::{CompilerDiagnostic, semantic::VindurImports};

use super::vindur_fn_references::{
    is_css_template_attribute, is_styled_tag, is_vindur_template_tag,
};

/// Top level bindings referenced as values, e.g. `const El = cond ? A : B` or
/// `<Menu button={A} />`. References as JSX element names, in vindur templates and
/// css prop templates (`${A}` selectors, `styled(A)`) and in `A.withComponent()` are compiled
/// away, so they are not included. Styled components referenced as values must be kept as
/// runtime components.
///
/// `withComponent()` is only compiled as the initializer of a top-level variable, any other
/// call on a local styled component is an error. Styled components are matched in JSX by name,
/// so local bindings shadowing a styled component are an error too.
pub(super) fn collect_value_referenced_names(
    program: &Program<'_>,
    scoping: &Scoping,
    imports: &VindurImports<'_>,
    file_path: &str,
    source: &str,
) -> Result<FxHashSet<String>, CompilerDiagnostic> {
    let top_level = top_level_styled_declarations(program, imports);
    if let Some((span, message)) = shadowed_styled_component(scoping, &top_level.styled_symbols) {
        return Err(CompilerDiagnostic::error(file_path, source, span, message));
    }
    let mut visitor = ValueReferenceVisitor {
        scoping,
        imports,
        styled_symbols: top_level.styled_symbols,
        top_level_with_component_calls: top_level.with_component_calls,
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
    styled_symbols: FxHashSet<SymbolId>,
    /// The `withComponent()` calls compiled by `process_with_component`
    top_level_with_component_calls: FxHashSet<Span>,
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
        if is_vindur_template_tag(&tagged.tag, self.imports) {
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
                && !self.top_level_with_component_calls.contains(&call.span)
                && self
                    .top_level_symbol(base)
                    .is_some_and(|symbol_id| self.styled_symbols.contains(&symbol_id))
            {
                self.first_error = Some((
                    call.span,
                    format!(
                        "\"{name}.withComponent()\" must be assigned directly to a top-level variable, e.g. `const Link = {name}.withComponent('a')`",
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
            .map(|reference_id| self.scoping.get_reference(reference_id))
            .filter(|reference| reference.is_value())
            .and_then(|reference| reference.symbol_id())
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

struct TopLevelStyledDeclarations {
    styled_symbols: FxHashSet<SymbolId>,
    with_component_calls: FxHashSet<Span>,
}

fn top_level_styled_declarations(
    program: &Program<'_>,
    imports: &VindurImports<'_>,
) -> TopLevelStyledDeclarations {
    let mut declarations = TopLevelStyledDeclarations {
        styled_symbols: FxHashSet::default(),
        with_component_calls: FxHashSet::default(),
    };
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
            // Other binding patterns aren't compiled
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                continue;
            };
            let Some(initializer) = &declarator.init else {
                continue;
            };
            let is_styled = match initializer.without_parentheses() {
                Expression::CallExpression(call) if is_with_component_call(call) => {
                    declarations.with_component_calls.insert(call.span);
                    true
                }
                Expression::TaggedTemplateExpression(tagged) => is_styled_tag(&tagged.tag, imports),
                _ => false,
            };
            if is_styled && let Some(symbol_id) = identifier.symbol_id.get() {
                declarations.styled_symbols.insert(symbol_id);
            }
        }
    }
    declarations
}

fn is_with_component_call(call: &CallExpression<'_>) -> bool {
    matches!(&call.callee, Expression::StaticMemberExpression(member) if member.property.name.as_str() == "withComponent")
}

fn shadowed_styled_component(
    scoping: &Scoping,
    styled_symbols: &FxHashSet<SymbolId>,
) -> Option<(Span, String)> {
    let styled_names: FxHashSet<&str> = styled_symbols
        .iter()
        .map(|symbol_id| scoping.symbol_name(*symbol_id))
        .collect();
    if styled_names.is_empty() {
        return None;
    }
    scoping
        .symbol_ids()
        .find(|symbol_id| {
            scoping.symbol_scope_id(*symbol_id) != scoping.root_scope_id()
                && scoping.symbol_flags(*symbol_id).is_value()
                && styled_names.contains(scoping.symbol_name(*symbol_id))
        })
        .map(|symbol_id| {
            let name = scoping.symbol_name(symbol_id);
            (
                scoping.symbol_span(symbol_id),
                format!("\"{name}\" shadows the styled component \"{name}\", rename this binding"),
            )
        })
}
