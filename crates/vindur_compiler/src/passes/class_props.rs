use oxc_ast::ast::{
    BindingIdentifier, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXClosingElement,
    JSXElementName, JSXExpression, JSXOpeningElement, Program,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{Scoping, SymbolId};
use rustc_hash::FxHashMap;

#[derive(Clone, Copy, Debug, Default)]
struct JsxUsage {
    references: usize,
    has_class_props: bool,
}

/// The JSX usages of each component of a file, collected once for all its styled components
#[derive(Debug, Default)]
pub(super) struct ClassPropUsages {
    usages: FxHashMap<SymbolId, JsxUsage>,
}

impl ClassPropUsages {
    pub(super) fn collect(program: &Program<'_>, scoping: &Scoping) -> Self {
        let mut visitor = ClassPropsVisitor {
            scoping,
            usages: FxHashMap::default(),
        };
        visitor.visit_program(program);
        Self {
            usages: visitor.usages,
        }
    }

    /// Whether the component is only rendered as JSX elements of this file without a
    /// `className`, `cx`, `css` or spread prop, or not used at all, so none of these can add a
    /// class to it
    pub(super) fn renders_without_class_props(
        &self,
        scoping: &Scoping,
        identifier: &BindingIdentifier<'_>,
    ) -> bool {
        let Some(symbol_id) = identifier.symbol_id.get() else {
            return false;
        };
        let usage = self.usages.get(&symbol_id).copied().unwrap_or_default();
        !usage.has_class_props
            // Any other value reference, like `styled(Box)` or a value passed around, can add
            // classes, type references like `typeof Box` can't
            && usage.references
                == scoping
                    .get_resolved_references(symbol_id)
                    .filter(|reference| reference.is_value())
                    .count()
    }
}

struct ClassPropsVisitor<'s> {
    scoping: &'s Scoping,
    usages: FxHashMap<SymbolId, JsxUsage>,
}

impl ClassPropsVisitor<'_> {
    fn usage(&mut self, name: &JSXElementName<'_>) -> Option<&mut JsxUsage> {
        let JSXElementName::IdentifierReference(identifier) = name else {
            return None;
        };
        let symbol_id = self
            .scoping
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        Some(self.usages.entry(symbol_id).or_default())
    }
}

impl<'a> Visit<'a> for ClassPropsVisitor<'_> {
    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        let has_class_props = element.attributes.iter().any(|attribute| match attribute {
            JSXAttributeItem::SpreadAttribute(_) => true,
            JSXAttributeItem::Attribute(attribute) => match &attribute.name {
                JSXAttributeName::Identifier(name) => match name.name.as_str() {
                    "className" | "css" => true,
                    // Only an object `cx` adds classes, others are kept as the native SVG `cx`
                    // coordinate or a component prop
                    "cx" => matches!(
                        &attribute.value,
                        Some(JSXAttributeValue::ExpressionContainer(container))
                            if matches!(container.expression, JSXExpression::ObjectExpression(_))
                    ),
                    _ => false,
                },
                JSXAttributeName::NamespacedName(_) => false,
            },
        });
        if let Some(usage) = self.usage(&element.name) {
            usage.references += 1;
            usage.has_class_props |= has_class_props;
        }
        walk::walk_jsx_opening_element(self, element);
    }

    fn visit_jsx_closing_element(&mut self, element: &JSXClosingElement<'a>) {
        if let Some(usage) = self.usage(&element.name) {
            usage.references += 1;
        }
        walk::walk_jsx_closing_element(self, element);
    }
}
