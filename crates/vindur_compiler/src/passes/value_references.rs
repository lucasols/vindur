use oxc_ast::ast::{
    CallExpression, Expression, IdentifierReference, JSXAttribute, JSXAttributeItem,
    JSXAttributeName, JSXClosingElement, JSXElementName, JSXOpeningElement, Program, TSTypeQuery,
    TaggedTemplateExpression,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use rustc_hash::FxHashSet;

use crate::semantic::VindurImports;

/// Top level bindings referenced as values, e.g. `const El = cond ? A : B` or
/// `<Menu button={A} />`. References as JSX element names, in vindur templates and
/// css props (`${A}` selectors, `styled(A)`) and in `A.withComponent()` are compiled
/// away, so they are not included. Styled components referenced as values must be kept as
/// runtime components.
pub(super) fn collect_value_referenced_names(
    program: &Program<'_>,
    scoping: &Scoping,
    imports: &VindurImports<'_>,
) -> FxHashSet<String> {
    let mut visitor = ValueReferenceVisitor {
        scoping,
        imports,
        names: FxHashSet::default(),
    };
    visitor.visit_program(program);
    visitor.names
}

struct ValueReferenceVisitor<'s, 'i> {
    scoping: &'s Scoping,
    imports: &'i VindurImports<'i>,
    names: FxHashSet<String>,
}

impl<'a> Visit<'a> for ValueReferenceVisitor<'_, '_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let Some(reference_id) = identifier.reference_id.get() else {
            return;
        };
        let Some(symbol_id) = self.scoping.get_reference(reference_id).symbol_id() else {
            return;
        };
        if self.scoping.symbol_scope_id(symbol_id) == self.scoping.root_scope_id() {
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
                JSXAttributeItem::Attribute(attribute) if is_css_attribute(attribute) => {}
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
        let is_vindur_template = tag_root(&tagged.tag)
            .is_some_and(|identifier| self.imports.get_identifier(identifier).is_some());
        if !is_vindur_template {
            walk::walk_tagged_template_expression(self, tagged);
        }
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(member) = &call.callee
            && member.property.name.as_str() == "withComponent"
            && matches!(member.object, Expression::Identifier(_))
        {
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

fn is_css_attribute(attribute: &JSXAttribute<'_>) -> bool {
    matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "css")
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
