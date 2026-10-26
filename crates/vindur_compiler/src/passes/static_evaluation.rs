use std::borrow::Cow;

use oxc_ast::ast::{
    Argument, ArrayExpression, BindingPattern, Expression, IdentifierReference, ObjectExpression,
    ObjectProperty, ObjectPropertyKind, TemplateLiteral, VariableDeclaration,
    VariableDeclarationKind,
};
use oxc_ast_visit::Visit;
use oxc_ecmascript::{
    GlobalContext, ToBoolean, ToJsString, ToNumber, WithoutGlobalReferenceInformation,
    constant_evaluation::{ConstantValue, ValueType},
    side_effects::{MayHaveSideEffects, MayHaveSideEffectsContext, PropertyReadSideEffects},
};
use oxc_semantic::Scoping;
use oxc_syntax::operator::{BinaryOperator, UnaryOperator};
use oxc_syntax::reference::ReferenceId;
use rustc_hash::FxHashMap;

use crate::{facts::StaticValue, semantic::VindurImports};

use super::css::layer_marker;
use super::css_syntax::is_layer_name;
use super::dynamic_color_value::{dynamic_color_member, dynamic_color_method};
use super::function_evaluation::{evaluate_argument, evaluate_function};
use super::function_value::compile_vindur_function;
use super::theme_color::{theme_member, theme_method};

pub(super) fn collect_declaration_constants(
    declaration: &VariableDeclaration<'_>,
    constants: &mut FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    imports: &VindurImports<'_>,
) {
    if declaration.kind != VariableDeclarationKind::Const {
        return;
    }

    for declarator in &declaration.declarations {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            continue;
        };
        let Some(initializer) = &declarator.init else {
            continue;
        };
        if let Some(value) = compile_vindur_function(initializer, imports)
            .or_else(|| evaluate_expression(initializer, constants, scoping))
        {
            if !matches!(value, StaticValue::Keyframes(_))
                && references_keyframes(initializer, constants, scoping)
            {
                continue;
            }
            constants.insert(identifier.name.to_string(), value);
        }
    }
}

/// Keyframes names can't be folded into other constants, e.g. `${spin} 1s`: the folded value
/// loses the keyframes CSS, so an importer of the constant would not load it
fn references_keyframes(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> bool {
    struct KeyframesReferenceVisitor<'c> {
        constants: &'c FxHashMap<String, StaticValue>,
        scoping: &'c Scoping,
        found: bool,
    }

    impl<'a> Visit<'a> for KeyframesReferenceVisitor<'_> {
        fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
            self.found |= matches!(
                resolved_constant(identifier, self.constants, self.scoping),
                Some(StaticValue::Keyframes(_))
            );
        }
    }

    let mut visitor = KeyframesReferenceVisitor {
        constants,
        scoping,
        found: false,
    };
    visitor.visit_expression(expression);
    visitor.found
}

pub(super) fn evaluate_expression(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Option<StaticValue> {
    match expression {
        Expression::BooleanLiteral(literal) => Some(StaticValue::Boolean(literal.value)),
        Expression::StringLiteral(literal) => Some(StaticValue::String(literal.value.to_string())),
        Expression::NumericLiteral(literal) => Some(StaticValue::Number(literal.value)),
        Expression::Identifier(identifier) if identifier.name.as_str() == "undefined" => {
            Some(StaticValue::Undefined)
        }
        Expression::Identifier(identifier) => {
            match resolved_constant(identifier, constants, scoping)? {
                StaticValue::ImportedValue { value, .. } => Some(*value.clone()),
                // Imports without a static value can't be evaluated
                StaticValue::MissingImport { .. }
                | StaticValue::InvalidFunction { .. }
                | StaticValue::InvalidObject { .. } => None,
                value => Some(value.clone()),
            }
        }
        Expression::ArrayExpression(array) => evaluate_array(array, constants, scoping),
        Expression::StaticMemberExpression(member) => {
            let analysis = StaticAnalysisContext { constants, scoping };
            if analysis.is_global_expr("Math", &member.object) {
                return math_constant(member.property.name.as_str()).map(StaticValue::Number);
            }
            let value = evaluate_expression(&member.object, constants, scoping)?;
            match &value {
                StaticValue::ClassName(value) => match member.property.name.as_str() {
                    "selector" => Some(StaticValue::String(format!(".{value}"))),
                    "value" => Some(StaticValue::String(value.clone())),
                    _ => None,
                },
                StaticValue::Object(properties)
                | StaticValue::ImportedObject { properties, .. } => {
                    properties.get(member.property.name.as_str()).cloned()
                }
                value => theme_member(value, member.property.name.as_str())
                    .or_else(|| dynamic_color_member(value, member.property.name.as_str())),
            }
        }
        Expression::ObjectExpression(object) => evaluate_object(object, constants, scoping),
        Expression::CallExpression(call) => {
            if let Expression::Identifier(callee) = &call.callee {
                match resolved_constant(callee, constants, scoping)? {
                    StaticValue::LayerFunction => {
                        let [Argument::StringLiteral(name)] = call.arguments.as_slice() else {
                            return None;
                        };
                        is_layer_name(&name.value)
                            .then(|| StaticValue::String(layer_marker(&name.value)))
                    }
                    StaticValue::Function(function) | StaticValue::ImportedFunction(function) => {
                        let arguments = call
                            .arguments
                            .iter()
                            .map(|argument| evaluate_argument(argument, constants, scoping))
                            .collect::<Option<Vec<_>>>()?;
                        evaluate_function(function, &arguments)
                    }
                    _ => None,
                }
            } else if let Expression::StaticMemberExpression(callee) = &call.callee {
                let receiver = evaluate_expression(&callee.object, constants, scoping)?;
                let amount = color_method_amount(&call.arguments, constants, scoping).ok()?;
                dynamic_color_method(&receiver, callee.property.name.as_str(), amount)
                    .or_else(|| theme_method(&receiver, callee.property.name.as_str(), amount))
            } else {
                None
            }
        }
        Expression::TemplateLiteral(template) => {
            evaluate_template_value(template, constants, scoping).map(StaticValue::String)
        }
        Expression::BinaryExpression(binary) => {
            let analysis = StaticAnalysisContext { constants, scoping };
            if arithmetic_has_side_effects(expression, &analysis) {
                return None;
            }
            let left = evaluate_expression(&binary.left, constants, scoping)?;
            let right = evaluate_expression(&binary.right, constants, scoping)?;
            evaluate_binary(left, binary.operator, right)
        }
        Expression::UnaryExpression(unary) => {
            let analysis = StaticAnalysisContext { constants, scoping };
            if arithmetic_has_side_effects(expression, &analysis) {
                return None;
            }
            let value = evaluate_expression(&unary.argument, constants, scoping)?;
            let value = oxc_constant_value(&value)?;
            match unary.operator {
                UnaryOperator::UnaryNegation => Some(StaticValue::Number(
                    -value.to_number(&WithoutGlobalReferenceInformation)?,
                )),
                UnaryOperator::UnaryPlus => Some(StaticValue::Number(
                    value.to_number(&WithoutGlobalReferenceInformation)?,
                )),
                UnaryOperator::LogicalNot => Some(StaticValue::Boolean(
                    !value.to_boolean(&WithoutGlobalReferenceInformation)?,
                )),
                _ => None,
            }
        }
        Expression::ParenthesizedExpression(parenthesized) => {
            evaluate_expression(&parenthesized.expression, constants, scoping)
        }
        _ => None,
    }
}

/// The amount of a color method call, e.g. `0.5` in `color.alpha(0.5)` or
/// `color.contrast.optimal({ alpha: 0.5 })`, an error if it isn't a static number
pub(super) fn color_method_amount(
    arguments: &[Argument<'_>],
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Result<Option<f64>, ()> {
    let Some(argument) = arguments.first() else {
        return Ok(None);
    };
    let expression = argument.as_expression().ok_or(())?;
    match evaluate_expression(expression, constants, scoping).ok_or(())? {
        StaticValue::Number(value) => Ok(Some(value)),
        StaticValue::Object(properties) => match properties.get("alpha") {
            Some(StaticValue::Number(value)) => Ok(Some(*value)),
            Some(_) => Err(()),
            None => Ok(None),
        },
        _ => Err(()),
    }
}

// Operand coercion is handled using StaticValue below. Oxc cannot infer the
// numeric type of Math constants, so check operand reads separately from coercion.
fn arithmetic_has_side_effects<'a>(
    expression: &Expression<'a>,
    analysis: &StaticAnalysisContext<'_>,
) -> bool {
    match expression {
        Expression::BinaryExpression(binary) => {
            arithmetic_has_side_effects(&binary.left, analysis)
                || arithmetic_has_side_effects(&binary.right, analysis)
        }
        Expression::UnaryExpression(unary) => {
            arithmetic_has_side_effects(&unary.argument, analysis)
        }
        Expression::ParenthesizedExpression(parenthesized) => {
            arithmetic_has_side_effects(&parenthesized.expression, analysis)
        }
        _ => expression.may_have_side_effects(analysis),
    }
}

fn math_constant(name: &str) -> Option<f64> {
    use std::f64::consts;

    match name {
        "E" => Some(consts::E),
        "LN2" => Some(consts::LN_2),
        "LN10" => Some(consts::LN_10),
        "LOG2E" => Some(consts::LOG2_E),
        "LOG10E" => Some(consts::LOG10_E),
        "PI" => Some(consts::PI),
        "SQRT1_2" => Some(consts::FRAC_1_SQRT_2),
        "SQRT2" => Some(consts::SQRT_2),
        _ => None,
    }
}

fn evaluate_object(
    object: &ObjectExpression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Option<StaticValue> {
    let mut properties = FxHashMap::default();
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        if is_prototype_setter(property) {
            return None;
        }
        let name = property.key.static_name()?.into_owned();
        let value = evaluate_expression(&property.value, constants, scoping)?;
        properties.insert(name, value);
    }
    Some(StaticValue::Object(properties))
}

/// `{ __proto__: value }` sets the prototype instead of defining a property
pub(super) fn is_prototype_setter(property: &ObjectProperty<'_>) -> bool {
    !property.computed
        && !property.shorthand
        && property
            .key
            .static_name()
            .is_some_and(|name| name == "__proto__")
}

fn evaluate_array(
    array: &ArrayExpression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Option<StaticValue> {
    let elements = array
        .elements
        .iter()
        .map(|element| {
            let expression = element.as_expression()?;
            if !matches!(
                expression,
                Expression::StringLiteral(_) | Expression::NumericLiteral(_)
            ) {
                return None;
            }
            evaluate_expression(expression, constants, scoping)
        })
        .collect::<Option<Vec<_>>>()?;
    Some(StaticValue::Array(elements))
}

fn evaluate_template_value(
    template: &TemplateLiteral<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Option<String> {
    let mut output = String::new();
    for (index, quasi) in template.quasis.iter().enumerate() {
        output.push_str(
            quasi
                .value
                .cooked
                .as_ref()
                .unwrap_or(&quasi.value.raw)
                .as_str(),
        );
        if let Some(expression) = template.expressions.get(index) {
            output.push_str(&static_value_to_string(&evaluate_expression(
                expression, constants, scoping,
            )?)?);
        }
    }
    Some(output)
}

pub(super) fn evaluate_binary(
    left: StaticValue,
    operator: BinaryOperator,
    right: StaticValue,
) -> Option<StaticValue> {
    match (left, operator, right) {
        // Loose equality coerces values of different types, which is not evaluated
        (left, BinaryOperator::Equality | BinaryOperator::Inequality, right)
            if !same_primitive_type(&left, &right) =>
        {
            None
        }
        // Objects and arrays are compared by identity, which static values don't have
        (left, BinaryOperator::StrictEquality | BinaryOperator::StrictInequality, right)
            if !is_primitive(&left) && !is_primitive(&right) =>
        {
            None
        }
        (left, BinaryOperator::Equality | BinaryOperator::StrictEquality, right) => {
            Some(StaticValue::Boolean(static_values_equal(&left, &right)))
        }
        (left, BinaryOperator::Inequality | BinaryOperator::StrictInequality, right) => {
            Some(StaticValue::Boolean(!static_values_equal(&left, &right)))
        }
        (StaticValue::Number(left), BinaryOperator::Addition, StaticValue::Number(right)) => {
            Some(StaticValue::Number(left + right))
        }
        (StaticValue::Number(left), BinaryOperator::Subtraction, StaticValue::Number(right)) => {
            Some(StaticValue::Number(left - right))
        }
        (StaticValue::Number(left), BinaryOperator::Multiplication, StaticValue::Number(right)) => {
            Some(StaticValue::Number(left * right))
        }
        (StaticValue::Number(_), BinaryOperator::Division, StaticValue::Number(0.0)) => None,
        (StaticValue::Number(left), BinaryOperator::Division, StaticValue::Number(right)) => {
            Some(StaticValue::Number(left / right))
        }
        (StaticValue::String(left), BinaryOperator::Addition, StaticValue::String(right)) => {
            Some(StaticValue::String(left + &right))
        }
        _ => None,
    }
}

fn same_primitive_type(left: &StaticValue, right: &StaticValue) -> bool {
    matches!(
        (left, right),
        (StaticValue::Boolean(_), StaticValue::Boolean(_))
            | (StaticValue::Number(_), StaticValue::Number(_))
            | (StaticValue::String(_), StaticValue::String(_))
            | (StaticValue::Undefined, StaticValue::Undefined)
    )
}

fn is_primitive(value: &StaticValue) -> bool {
    matches!(
        value,
        StaticValue::Boolean(_)
            | StaticValue::Number(_)
            | StaticValue::String(_)
            | StaticValue::Undefined
    )
}

fn static_values_equal(left: &StaticValue, right: &StaticValue) -> bool {
    match (left, right) {
        (StaticValue::Boolean(left), StaticValue::Boolean(right)) => left == right,
        (StaticValue::Number(left), StaticValue::Number(right)) => left == right,
        (StaticValue::String(left), StaticValue::String(right)) => left == right,
        (StaticValue::Undefined, StaticValue::Undefined) => true,
        _ => false,
    }
}

/// The CSS text of a value, `None` for values without a CSS representation, e.g. functions,
/// objects or colors without `.var`
pub(super) fn static_value_to_string(value: &StaticValue) -> Option<String> {
    // `undefined` is never a valid CSS value, e.g. an optional vindurFn parameter without a default
    if matches!(value, StaticValue::Undefined) {
        return None;
    }
    if let Some(value) = oxc_constant_value(value)
        && let Some(value) = value.to_js_string(&WithoutGlobalReferenceInformation)
    {
        return Some(value.into_owned());
    }
    match value {
        StaticValue::Array(values) => Some(
            values
                .iter()
                .map(static_value_to_string)
                .collect::<Option<Vec<_>>>()?
                .join(","),
        ),
        StaticValue::ClassName(value) => Some(format!(".{value}")),
        StaticValue::Keyframes(value) => Some(value.clone()),
        StaticValue::ImportedValue { value, .. } => static_value_to_string(value),
        StaticValue::Boolean(_)
        | StaticValue::Number(_)
        | StaticValue::String(_)
        | StaticValue::Undefined => unreachable!(),
        // A css class is a selector or its styles depending on where it's interpolated, only
        // css templates can tell which
        StaticValue::CssClass { .. }
        | StaticValue::DynamicColor { .. }
        | StaticValue::DynamicColorPath { .. }
        | StaticValue::LayerFunction
        | StaticValue::MissingImport { .. }
        | StaticValue::InvalidFunction { .. }
        | StaticValue::InvalidObject { .. }
        | StaticValue::Function(_)
        | StaticValue::ImportedFunction(_)
        | StaticValue::Object(_)
        | StaticValue::ImportedObject { .. }
        | StaticValue::ThemeColor { .. }
        | StaticValue::ThemeColorContrast { .. }
        | StaticValue::ThemeColors(_)
        | StaticValue::UnexportedThemeColors(_) => None,
    }
}

pub(super) fn static_value_to_boolean(value: &StaticValue) -> bool {
    oxc_constant_value(value)
        .and_then(|value| value.to_boolean(&WithoutGlobalReferenceInformation))
        .unwrap_or(true)
}

pub(super) fn resolved_constant<'a>(
    identifier: &IdentifierReference<'_>,
    constants: &'a FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Option<&'a StaticValue> {
    let reference_id = identifier.reference_id.get()?;
    let symbol_id = scoping.get_reference(reference_id).symbol_id()?;
    if scoping.symbol_scope_id(symbol_id) != scoping.root_scope_id() {
        return None;
    }
    constants.get(identifier.name.as_str())
}

fn oxc_constant_value(value: &StaticValue) -> Option<ConstantValue<'static>> {
    match value {
        StaticValue::Boolean(value) => Some(ConstantValue::Boolean(*value)),
        StaticValue::ImportedValue { value, .. } => oxc_constant_value(value),
        StaticValue::Number(value) => Some(ConstantValue::Number(*value)),
        StaticValue::String(value) => Some(ConstantValue::String(Cow::Owned(value.clone()))),
        StaticValue::Undefined => Some(ConstantValue::Undefined),
        _ => None,
    }
}

struct StaticAnalysisContext<'a> {
    constants: &'a FxHashMap<String, StaticValue>,
    scoping: &'a Scoping,
}

impl StaticAnalysisContext<'_> {
    fn constant_for_reference(&self, reference_id: ReferenceId) -> Option<ConstantValue<'static>> {
        let symbol_id = self.scoping.get_reference(reference_id).symbol_id()?;
        if self.scoping.symbol_scope_id(symbol_id) != self.scoping.root_scope_id() {
            return None;
        }
        oxc_constant_value(self.constants.get(self.scoping.symbol_name(symbol_id))?)
    }
}

impl<'a> GlobalContext<'a> for StaticAnalysisContext<'_> {
    fn is_global_reference(&self, reference: &IdentifierReference<'a>) -> bool {
        reference.reference_id.get().is_none_or(|reference_id| {
            self.scoping
                .get_reference(reference_id)
                .symbol_id()
                .is_none()
        })
    }

    fn get_constant_value_for_reference_id(
        &self,
        reference_id: ReferenceId,
    ) -> Option<ConstantValue<'a>> {
        self.constant_for_reference(reference_id)
    }

    fn value_type_for_reference_id(&self, reference_id: ReferenceId) -> Option<ValueType> {
        self.constant_for_reference(reference_id)
            .map(|value| value.value_type())
    }
}

impl<'a> MayHaveSideEffectsContext<'a> for StaticAnalysisContext<'_> {
    fn annotations(&self) -> bool {
        false
    }

    fn manual_pure_functions(&self, callee: &Expression<'_>) -> bool {
        let Expression::Identifier(identifier) = callee else {
            return false;
        };
        let Some(reference_id) = identifier.reference_id.get() else {
            return false;
        };
        let Some(symbol_id) = self.scoping.get_reference(reference_id).symbol_id() else {
            return false;
        };
        if self.scoping.symbol_scope_id(symbol_id) != self.scoping.root_scope_id() {
            return false;
        }
        matches!(
            self.constants.get(self.scoping.symbol_name(symbol_id)),
            Some(
                StaticValue::Function(_)
                    | StaticValue::ImportedFunction(_)
                    | StaticValue::LayerFunction
            )
        )
    }

    fn property_read_side_effects(&self) -> PropertyReadSideEffects {
        PropertyReadSideEffects::All
    }

    fn unknown_global_side_effects(&self) -> bool {
        true
    }
}
