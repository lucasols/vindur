use oxc_ast::ast::{
    Argument, BindingPattern, CallExpression, ComputedMemberExpression, Declaration, Expression,
    IdentifierReference, JSXAttributeItem, JSXClosingElement, JSXElementName, JSXOpeningElement,
    Program, Statement, StaticMemberExpression, TSTypeQuery, TaggedTemplateExpression,
};
use std::cell::Cell;

use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{ScopeFlags, ScopeId, Scoping, SymbolId};
use oxc_span::Span;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{CompilerDiagnostic, semantic::VindurImports};

use super::styled::{StyledComponent, styled_base_root_name};
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
) -> Result<ValueReferences, CompilerDiagnostic> {
    let top_level = top_level_styled_declarations(program, imports);
    if let Some((span, message)) = shadowed_styled_component(scoping, &top_level.styled_symbols) {
        return Err(CompilerDiagnostic::error(file_path, source, span, message));
    }
    let mut visitor = ValueReferenceVisitor {
        scoping,
        imports,
        styled_symbols: top_level.styled_symbols,
        top_level_with_component_calls: top_level.with_component_calls,
        base_names: top_level.base_names,
        scopes: Vec::new(),
        names: FxHashSet::default(),
        shadowed_bases: Vec::new(),
        first_error: None,
    };
    visitor.visit_program(program);
    match visitor.first_error {
        Some((span, message)) => Err(CompilerDiagnostic::error(file_path, source, span, message)),
        None => Ok(ValueReferences {
            names: visitor.names,
            shadowed_bases: visitor.shadowed_bases,
        }),
    }
}

pub(super) struct ValueReferences {
    pub names: FxHashSet<String>,
    /// Usages of styled components whose base is shadowed where they are used
    pub shadowed_bases: Vec<ShadowedBase>,
}

/// A local binding with the name of the component a styled component is built from, where that
/// styled component is used in JSX, e.g. a `Card` prop where `<StyledCard />` of `styled(Card)`
/// is used. Only an error when the JSX is compiled to the base, runtime components keep their own
/// reference to it
pub(super) struct ShadowedBase {
    /// The used styled component and the ones it renders, up to the one built from the base
    pub chain: Vec<String>,
    pub span: Span,
    pub message: String,
}

impl ShadowedBase {
    /// The error of the first usage compiled to its base. The JSX of a runtime component is kept,
    /// and a runtime component in the chain is rendered instead of the base
    pub(super) fn first_error(
        shadowed: &[Self],
        components: &FxHashMap<String, StyledComponent>,
        file_path: &str,
        source: &str,
    ) -> Result<(), CompilerDiagnostic> {
        match shadowed.iter().find(|shadowed| {
            shadowed.chain.iter().all(|name| {
                components
                    .get(name)
                    .is_some_and(|component| !component.runtime)
            })
        }) {
            Some(shadowed) => Err(CompilerDiagnostic::error(
                file_path,
                source,
                shadowed.span,
                shadowed.message.clone(),
            )),
            None => Ok(()),
        }
    }
}

struct ValueReferenceVisitor<'s, 'i> {
    scoping: &'s Scoping,
    imports: &'i VindurImports<'i>,
    styled_symbols: FxHashSet<SymbolId>,
    /// The `withComponent()` calls compiled by `process_with_component`
    top_level_with_component_calls: FxHashSet<Span>,
    /// The component each styled component is built from, e.g. `Card` for `styled(Card)`
    base_names: FxHashMap<String, String>,
    scopes: Vec<ScopeId>,
    names: FxHashSet<String>,
    shadowed_bases: Vec<ShadowedBase>,
    first_error: Option<(Span, String)>,
}

impl<'a> Visit<'a> for ValueReferenceVisitor<'_, '_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if self.top_level_symbol(identifier).is_some() {
            self.names.insert(identifier.name.to_string());
        }
    }

    fn enter_scope(&mut self, _flags: ScopeFlags, scope_id: &Cell<Option<ScopeId>>) {
        if let Some(scope_id) = scope_id.get() {
            self.scopes.push(scope_id);
        }
    }

    fn leave_scope(&mut self) {
        self.scopes.pop();
    }

    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        match &element.name {
            JSXElementName::IdentifierReference(name) => self.record_shadowed_base(name),
            name => self.visit_jsx_element_name(name),
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
        // The compiled `withComponent()` keeps only its arguments
        if self.top_level_with_component_calls.contains(&call.span) {
            for argument in &call.arguments {
                self.visit_argument(argument);
            }
            return;
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_static_member_expression(&mut self, member: &StaticMemberExpression<'a>) {
        if member.property.name.as_str() == "withComponent" {
            self.reject_with_component_access(&member.object, member.span);
        }
        walk::walk_static_member_expression(self, member);
    }

    fn visit_computed_member_expression(&mut self, member: &ComputedMemberExpression<'a>) {
        if member
            .static_property_name()
            .is_some_and(|name| name.as_str() == "withComponent")
        {
            self.reject_with_component_access(&member.object, member.span);
        }
        walk::walk_computed_member_expression(self, member);
    }

    // `typeof A` in types has no runtime reference
    fn visit_ts_type_query(&mut self, _query: &TSTypeQuery<'a>) {}
}

impl ValueReferenceVisitor<'_, '_> {
    /// The JSX of styled components is compiled to the components they are built from, so a local
    /// binding with the name of one would render the binding instead, e.g. a `Card` prop where
    /// `<StyledCard />` of `styled(Card)` is used
    fn record_shadowed_base(&mut self, name: &IdentifierReference<'_>) {
        if !self
            .top_level_symbol(name)
            .is_some_and(|symbol_id| self.styled_symbols.contains(&symbol_id))
        {
            return;
        }
        let Some(&scope_id) = self.scopes.last() else {
            return;
        };
        // A styled component built from another one renders that one's base
        let mut component = name.name.as_str();
        let mut chain = Vec::new();
        while let Some(base) = self.base_names.get(component)
            && chain.len() < self.base_names.len()
        {
            chain.push(component.to_owned());
            if let Some(symbol_id) = self.value_binding(scope_id, base)
                && self.scoping.symbol_scope_id(symbol_id) != self.scoping.root_scope_id()
            {
                self.shadowed_bases.push(ShadowedBase {
                    chain,
                    span: self.scoping.symbol_span(symbol_id),
                    message: format!(
                        "\"{base}\" shadows the component \"{base}\" a styled component is built from, rename this binding"
                    ),
                });
                return;
            }
            component = base;
        }
    }

    /// The value binding `name` resolves to from the scope, type bindings like `<Card>` type
    /// parameters don't shadow values
    fn value_binding(&self, scope_id: ScopeId, name: &str) -> Option<SymbolId> {
        self.scoping
            .scope_ancestors(scope_id)
            .filter_map(|scope_id| self.scoping.get_binding(scope_id, name.into()))
            .find(|symbol_id| self.scoping.symbol_flags(*symbol_id).is_value())
    }

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

    /// Any `withComponent` access on a local styled component other than the compiled
    /// `const Link = Button.withComponent('a')` is kept at runtime, where it doesn't exist
    fn reject_with_component_access(&mut self, object: &Expression<'_>, span: Span) {
        if self.first_error.is_some() {
            return;
        }
        let Expression::Identifier(base) = object.without_parentheses() else {
            return;
        };
        if self
            .top_level_symbol(base)
            .is_some_and(|symbol_id| self.styled_symbols.contains(&symbol_id))
        {
            self.first_error = Some((
                span,
                format!(
                    "\"{name}.withComponent()\" must be assigned directly to a top-level variable, e.g. `const Link = {name}.withComponent('a')`",
                    name = base.name
                ),
            ));
        }
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
    /// The component each styled component is built from, e.g. `Card` for `styled(Card)`
    base_names: FxHashMap<String, String>,
}

fn top_level_styled_declarations(
    program: &Program<'_>,
    imports: &VindurImports<'_>,
) -> TopLevelStyledDeclarations {
    let mut declarations = TopLevelStyledDeclarations {
        styled_symbols: FxHashSet::default(),
        with_component_calls: FxHashSet::default(),
        base_names: FxHashMap::default(),
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
                    if let [Argument::Identifier(base)] = call.arguments.as_slice() {
                        declarations
                            .base_names
                            .insert(identifier.name.to_string(), base.name.to_string());
                    }
                    true
                }
                Expression::TaggedTemplateExpression(tagged) => {
                    let is_styled = is_styled_tag(&tagged.tag, imports);
                    if is_styled && let Some(base) = styled_base_root_name(&tagged.tag) {
                        declarations
                            .base_names
                            .insert(identifier.name.to_string(), base.to_owned());
                    }
                    is_styled
                }
                _ => false,
            };
            if is_styled && let Some(symbol_id) = identifier.symbol_id.get() {
                declarations.styled_symbols.insert(symbol_id);
            }
        }
    }
    declarations
}

/// The form compiled by `process_with_component`
fn is_with_component_call(call: &CallExpression<'_>) -> bool {
    matches!(
        &call.callee,
        Expression::StaticMemberExpression(member)
            if member.property.name.as_str() == "withComponent"
                && matches!(member.object, Expression::Identifier(_))
    )
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
            let flags = scoping.symbol_flags(*symbol_id);
            scoping.symbol_scope_id(*symbol_id) != scoping.root_scope_id()
                && flags.is_value()
                && !flags.is_enum_member()
                // Unreferenced bindings, like parameters of type signatures, can't be
                // confused with the styled component
                && !scoping.get_resolved_reference_ids(*symbol_id).is_empty()
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
