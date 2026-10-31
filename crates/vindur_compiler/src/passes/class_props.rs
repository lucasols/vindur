use oxc_ast::ast::{
    BindingIdentifier, JSXAttributeItem, JSXAttributeName, JSXClosingElement, JSXElementName,
    JSXOpeningElement, Program,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{Scoping, SymbolId};

/// Whether the component is only rendered as JSX elements of this file without a `className`,
/// `cx`, `css` or spread prop, or not used at all, so none of these can add a class to it
pub(super) fn renders_without_class_props(
    program: &Program<'_>,
    scoping: &Scoping,
    identifier: &BindingIdentifier<'_>,
) -> bool {
    let Some(symbol_id) = identifier.symbol_id.get() else {
        return false;
    };
    let mut visitor = ClassPropsVisitor {
        scoping,
        symbol_id,
        jsx_references: 0,
        has_class_props: false,
    };
    visitor.visit_program(program);
    !visitor.has_class_props
        // Any other value reference, like `styled(Box)` or a value passed around, can add
        // classes, type references like `typeof Box` can't
        && visitor.jsx_references
            == scoping
                .get_resolved_references(symbol_id)
                .filter(|reference| reference.is_value())
                .count()
}

struct ClassPropsVisitor<'s> {
    scoping: &'s Scoping,
    symbol_id: SymbolId,
    jsx_references: usize,
    has_class_props: bool,
}

impl ClassPropsVisitor<'_> {
    fn is_component(&self, name: &JSXElementName<'_>) -> bool {
        let JSXElementName::IdentifierReference(identifier) = name else {
            return false;
        };
        self.scoping
            .get_reference(identifier.reference_id())
            .symbol_id()
            == Some(self.symbol_id)
    }
}

impl<'a> Visit<'a> for ClassPropsVisitor<'_> {
    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        if self.is_component(&element.name) {
            self.jsx_references += 1;
            self.has_class_props |= element.attributes.iter().any(|attribute| match attribute {
                JSXAttributeItem::SpreadAttribute(_) => true,
                JSXAttributeItem::Attribute(attribute) => matches!(
                    &attribute.name,
                    JSXAttributeName::Identifier(name)
                        if matches!(name.name.as_str(), "className" | "cx" | "css")
                ),
            });
        }
        walk::walk_jsx_opening_element(self, element);
    }

    fn visit_jsx_closing_element(&mut self, element: &JSXClosingElement<'a>) {
        if self.is_component(&element.name) {
            self.jsx_references += 1;
        }
        walk::walk_jsx_closing_element(self, element);
    }
}
