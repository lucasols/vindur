use oxc_ast::ast::{Expression, JSXAttribute, JSXAttributeValue, JSXElementName};

use super::styled::StyledComponent;

// SVG elements with a native `cx` attribute
const SVG_CX_ELEMENTS: [&str; 3] = ["circle", "ellipse", "radialGradient"];

// `cx` is only vindur's prop when it's an object, other values are regular
// attributes on SVG elements (`<circle cx="50" />`) or props of custom components
pub(super) fn is_foreign_cx_attribute(
    element: &JSXElementName<'_>,
    attribute: &JSXAttribute<'_>,
) -> bool {
    let accepts_native_cx = match element {
        JSXElementName::Identifier(name) => SVG_CX_ELEMENTS.contains(&name.name.as_str()),
        _ => is_component_name(element),
    };
    accepts_native_cx && !is_object_attribute(attribute)
}

// The parser follows JSX: lowercase names are intrinsic elements, other tags
// (`<Pie />`, `<_Pie />`, `<R.Pie />`) are treated as components
pub(super) fn is_component_name(element: &JSXElementName<'_>) -> bool {
    !matches!(element, JSXElementName::Identifier(_))
}

pub(super) fn is_foreign_styled_cx_attribute(
    component: &StyledComponent,
    attribute: &JSXAttribute<'_>,
) -> bool {
    let accepts_native_cx =
        component.element_is_identifier || SVG_CX_ELEMENTS.contains(&component.element.as_str());
    accepts_native_cx && !is_object_attribute(attribute)
}

fn is_object_attribute(attribute: &JSXAttribute<'_>) -> bool {
    matches!(
        &attribute.value,
        Some(JSXAttributeValue::ExpressionContainer(container))
            if container.expression.as_expression().is_some_and(is_object_like)
    )
}

// Wrapped or conditional objects stay vindur's so they fail fast instead of
// reaching the DOM as `[object Object]`
fn is_object_like(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(_) => true,
        Expression::ConditionalExpression(conditional) => {
            is_object_like(&conditional.consequent) || is_object_like(&conditional.alternate)
        }
        Expression::LogicalExpression(logical) => {
            is_object_like(&logical.left) || is_object_like(&logical.right)
        }
        Expression::AssignmentExpression(assignment) => is_object_like(&assignment.right),
        Expression::SequenceExpression(sequence) => {
            sequence.expressions.last().is_some_and(is_object_like)
        }
        _ => false,
    }
}
