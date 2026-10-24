use oxc_ast::ast::{
    Expression, IdentifierReference, JSXAttribute, JSXAttributeName, JSXAttributeValue,
    JSXExpression, Program, TSTypeQuery, TaggedTemplateExpression,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Scoping;
use rustc_hash::FxHashSet;

use crate::semantic::VindurImports;

/// Top level bindings referenced in code that stays at runtime. References in vindur
/// templates and css prop templates are compiled away, `.attrs({})` values are kept at runtime.
/// E.g. an imported dynamic color only used in templates doesn't need its import,
/// one used by a `dynamicColor` prop or `setProps` call does.
pub(super) fn runtime_referenced_names(
    program: &Program<'_>,
    scoping: &Scoping,
    imports: &VindurImports<'_>,
) -> FxHashSet<String> {
    let mut visitor = RuntimeReferenceVisitor {
        scoping,
        imports,
        names: FxHashSet::default(),
    };
    visitor.visit_program(program);
    visitor.names
}

struct RuntimeReferenceVisitor<'s, 'i> {
    scoping: &'s Scoping,
    imports: &'i VindurImports<'i>,
    names: FxHashSet<String>,
}

impl<'a> Visit<'a> for RuntimeReferenceVisitor<'_, '_> {
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

    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        // The css prop template is compiled away like vindur templates, other values are
        // kept, e.g. `<Custom css={themeColor.var} />`
        let is_css_template = matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "css")
            && matches!(
                &attribute.value,
                Some(JSXAttributeValue::ExpressionContainer(container))
                    if matches!(container.expression, JSXExpression::TemplateLiteral(_))
            );
        if !is_css_template {
            walk::walk_jsx_attribute(self, attribute);
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

    // `typeof A` in types has no runtime reference
    fn visit_ts_type_query(&mut self, _query: &TSTypeQuery<'a>) {}
}

impl RuntimeReferenceVisitor<'_, '_> {
    /// `.attrs({})` values are kept in the runtime component, unlike the rest of the tag
    fn visit_runtime_tag_arguments(&mut self, tag: &Expression<'_>) {
        match tag {
            Expression::CallExpression(call) => {
                if let Expression::StaticMemberExpression(member) = &call.callee
                    && member.property.name.as_str() == "attrs"
                {
                    for argument in &call.arguments {
                        self.visit_argument(argument);
                    }
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
