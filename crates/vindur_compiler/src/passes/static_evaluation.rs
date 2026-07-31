use oxc_ast::ast::{
    Argument, ArrayExpression, BindingPattern, Expression, ObjectExpression, ObjectPropertyKind,
    TemplateLiteral, VariableDeclaration, VariableDeclarationKind,
};
use oxc_syntax::operator::BinaryOperator;
use rustc_hash::FxHashMap;

use crate::facts::StaticValue;

use super::dynamic_color_value::{dynamic_color_member, dynamic_color_method};
use super::function_evaluation::{evaluate_argument, evaluate_function};
use super::function_value::compile_vindur_function;
use super::theme_color::{theme_member, theme_method};

pub(super) fn collect_declaration_constants(
    declaration: &VariableDeclaration<'_>,
    constants: &mut FxHashMap<String, StaticValue>,
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
            .or_else(|| evaluate_expression(initializer, constants))
        {
            constants.insert(identifier.name.to_string(), value);
        }
    }
}

pub(super) fn evaluate_expression(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
) -> Option<StaticValue> {
    match expression {
        Expression::BooleanLiteral(literal) => Some(StaticValue::Boolean(literal.value)),
        Expression::StringLiteral(literal) => Some(StaticValue::String(literal.value.to_string())),
        Expression::NumericLiteral(literal) => Some(StaticValue::Number(literal.value)),
        Expression::Identifier(identifier) if identifier.name.as_str() == "undefined" => {
            Some(StaticValue::Undefined)
        }
        Expression::Identifier(identifier) => match constants.get(identifier.name.as_str())? {
            StaticValue::ImportedValue { value, .. } => Some(*value.clone()),
            value => Some(value.clone()),
        },
        Expression::ArrayExpression(array) => evaluate_array(array, constants),
        Expression::StaticMemberExpression(member) => {
            let value = evaluate_expression(&member.object, constants)?;
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
        Expression::ObjectExpression(object) => evaluate_object(object, constants),
        Expression::CallExpression(call) => {
            if let Expression::Identifier(callee) = &call.callee {
                match constants.get(callee.name.as_str())? {
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
                            .map(|argument| evaluate_argument(argument, constants))
                            .collect::<Option<Vec<_>>>()?;
                        evaluate_function(function, &arguments)
                    }
                    _ => None,
                }
            } else if let Expression::StaticMemberExpression(callee) = &call.callee {
                let receiver = evaluate_expression(&callee.object, constants)?;
                let amount = call.arguments.first().and_then(|argument| match argument {
                    Argument::NumericLiteral(value) => Some(value.value),
                    Argument::ObjectExpression(object) => {
                        let StaticValue::Object(properties) = evaluate_object(object, constants)?
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
            evaluate_template_value(template, constants).map(StaticValue::String)
        }
        Expression::BinaryExpression(binary) => {
            let left = evaluate_expression(&binary.left, constants)?;
            let right = evaluate_expression(&binary.right, constants)?;
            evaluate_binary(left, binary.operator, right)
        }
        Expression::ParenthesizedExpression(parenthesized) => {
            evaluate_expression(&parenthesized.expression, constants)
        }
        _ => None,
    }
}

pub(super) fn evaluate_object(
    object: &ObjectExpression<'_>,
    constants: &FxHashMap<String, StaticValue>,
) -> Option<StaticValue> {
    let mut properties = FxHashMap::default();
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        let name = property.key.static_name()?.into_owned();
        let value = evaluate_expression(&property.value, constants)?;
        properties.insert(name, value);
    }
    Some(StaticValue::Object(properties))
}

pub(super) fn evaluate_array(
    array: &ArrayExpression<'_>,
    constants: &FxHashMap<String, StaticValue>,
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
            evaluate_expression(expression, constants)
        })
        .collect::<Option<Vec<_>>>()?;
    Some(StaticValue::Array(elements))
}

fn evaluate_template_value(
    template: &TemplateLiteral<'_>,
    constants: &FxHashMap<String, StaticValue>,
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
                expression, constants,
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
    match value {
        StaticValue::Array(values) => values
            .iter()
            .map(static_value_to_string)
            .collect::<Vec<_>>()
            .join(","),
        StaticValue::Boolean(value) => value.to_string(),
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
        StaticValue::Number(number) if number.fract() == 0.0 => format!("{number:.0}"),
        StaticValue::Number(number) => number.to_string(),
        StaticValue::Object(_) | StaticValue::ImportedObject { .. } => "[object Object]".to_owned(),
        StaticValue::String(string) => string.clone(),
        StaticValue::ThemeColor { .. }
        | StaticValue::ThemeColorContrast { .. }
        | StaticValue::ThemeColors(_)
        | StaticValue::UnexportedThemeColors(_) => "[theme color]".to_owned(),
        StaticValue::Undefined => "undefined".to_owned(),
    }
}
