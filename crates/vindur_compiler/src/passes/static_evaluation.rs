use std::borrow::Cow;

use oxc_ast::ast::{
    Argument, ArrayExpression, BindingPattern, Expression, IdentifierReference, ObjectExpression,
    ObjectPropertyKind, TemplateLiteral, VariableDeclaration, VariableDeclarationKind,
};
use oxc_ecmascript::{
    GlobalContext, ToBoolean, ToJsString, ToNumber, WithoutGlobalReferenceInformation,
    constant_evaluation::{ConstantValue, ValueType},
    side_effects::{MayHaveSideEffects, MayHaveSideEffectsContext, PropertyReadSideEffects},
};
use oxc_semantic::Scoping;
use oxc_syntax::operator::{BinaryOperator, UnaryOperator};
use oxc_syntax::reference::ReferenceId;
use rustc_hash::FxHashMap;

use crate::facts::StaticValue;

use super::dynamic_color_value::{dynamic_color_member, dynamic_color_method};
use super::function_evaluation::{evaluate_argument, evaluate_function};
use super::function_value::compile_vindur_function;
use super::theme_color::{theme_member, theme_method};

pub(super) fn collect_declaration_constants(
    declaration: &VariableDeclaration<'_>,
    constants: &mut FxHashMap<String, StaticValue>,
    scoping: &Scoping,
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
        if let Some(value) = compile_vindur_function(initializer)
            .or_else(|| evaluate_expression(initializer, constants, scoping))
        {
            constants.insert(identifier.name.to_string(), value);
        }
    }
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
                value => Some(value.clone()),
            }
        }
        Expression::ArrayExpression(array) => evaluate_array(array, constants, scoping),
        Expression::StaticMemberExpression(member) => {
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
                        Some(StaticValue::String(format!(
                            "__VINDUR_LAYER_START__{}__",
                            name.value
                        )))
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
                let amount = call.arguments.first().and_then(|argument| match argument {
                    Argument::NumericLiteral(value) => Some(value.value),
                    Argument::ObjectExpression(object) => {
                        let StaticValue::Object(properties) =
                            evaluate_object(object, constants, scoping)?
                        else {
                            return None;
                        };
                        let StaticValue::Number(value) = properties.get("alpha")? else {
                            return None;
                        };
                        Some(*value)
                    }
                    _ => None,
                });
                dynamic_color_method(&receiver, callee.property.name.as_str(), amount).or_else(
                    || {
                        theme_method(
                            &receiver,
                            callee.property.name.as_str(),
                            amount.unwrap_or(0.0),
                        )
                    },
                )
            } else {
                None
            }
        }
        Expression::TemplateLiteral(template) => {
            evaluate_template_value(template, constants, scoping).map(StaticValue::String)
        }
        Expression::BinaryExpression(binary) => {
            let analysis = StaticAnalysisContext { constants, scoping };
            if expression.may_have_side_effects(&analysis) {
                return None;
            }
            let left = evaluate_expression(&binary.left, constants, scoping)?;
            let right = evaluate_expression(&binary.right, constants, scoping)?;
            evaluate_binary(left, binary.operator, right)
        }
        Expression::UnaryExpression(unary) => {
            let analysis = StaticAnalysisContext { constants, scoping };
            if expression.may_have_side_effects(&analysis) {
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

pub(super) fn evaluate_object(
    object: &ObjectExpression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Option<StaticValue> {
    let mut properties = FxHashMap::default();
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        let name = property.key.static_name()?.into_owned();
        let value = evaluate_expression(&property.value, constants, scoping)?;
        properties.insert(name, value);
    }
    Some(StaticValue::Object(properties))
}

pub(super) fn evaluate_array(
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
            )?));
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

fn static_values_equal(left: &StaticValue, right: &StaticValue) -> bool {
    match (left, right) {
        (StaticValue::Boolean(left), StaticValue::Boolean(right)) => left == right,
        (StaticValue::Number(left), StaticValue::Number(right)) => left == right,
        (StaticValue::String(left), StaticValue::String(right)) => left == right,
        (StaticValue::Undefined, StaticValue::Undefined) => true,
        _ => false,
    }
}

pub(super) fn static_value_to_string(value: &StaticValue) -> String {
    if let Some(value) = oxc_constant_value(value)
        && let Some(value) = value.to_js_string(&WithoutGlobalReferenceInformation)
    {
        return value.into_owned();
    }
    match value {
        StaticValue::Array(values) => values
            .iter()
            .map(static_value_to_string)
            .collect::<Vec<_>>()
            .join(","),
        StaticValue::Boolean(_) => unreachable!(),
        StaticValue::ClassName(value) => format!(".{value}"),
        StaticValue::CssClass { css, .. } => css.clone(),
        StaticValue::DynamicColor { .. } | StaticValue::DynamicColorPath { .. } => {
            "[dynamic color]".to_owned()
        }
        StaticValue::Keyframes(value) => value.clone(),
        StaticValue::LayerFunction => String::new(),
        StaticValue::MissingImport { .. } => String::new(),
        StaticValue::InvalidFunction { .. } => String::new(),
        StaticValue::InvalidObject { .. } => String::new(),
        StaticValue::ImportedValue { value, .. } => static_value_to_string(value),
        StaticValue::Function(_) | StaticValue::ImportedFunction(_) => "[vindurFn]".to_owned(),
        StaticValue::Number(_) => unreachable!(),
        StaticValue::Object(_) | StaticValue::ImportedObject { .. } => "[object Object]".to_owned(),
        StaticValue::String(_) => unreachable!(),
        StaticValue::ThemeColor { .. }
        | StaticValue::ThemeColorContrast { .. }
        | StaticValue::ThemeColors(_)
        | StaticValue::UnexportedThemeColors(_) => "[theme color]".to_owned(),
        StaticValue::Undefined => unreachable!(),
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
