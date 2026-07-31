use oxc_ast::ast::Argument;
use oxc_semantic::Scoping;
use oxc_syntax::operator::BinaryOperator;
use rustc_hash::FxHashMap;

use crate::facts::{
    CompiledFunction, FunctionExpression, FunctionOperator, FunctionParameter, StaticValue,
};

use super::static_evaluation::{
    evaluate_array, evaluate_binary, evaluate_expression, evaluate_object, resolved_constant,
    static_value_to_boolean, static_value_to_string,
};

pub(super) fn evaluate_function(
    function: &CompiledFunction,
    arguments: &[StaticValue],
) -> Option<StaticValue> {
    if arguments.len() > function.parameters.len() {
        return None;
    }
    let mut bindings = FxHashMap::default();
    for (index, parameter) in function.parameters.iter().enumerate() {
        bind_parameter(parameter, arguments.get(index), &mut bindings)?;
    }
    evaluate_function_expression(&function.body, &bindings)
}

pub(super) fn function_binary_expression_error(
    function: &CompiledFunction,
    arguments: &[StaticValue],
) -> Option<String> {
    if arguments.len() > function.parameters.len() {
        return None;
    }
    let mut bindings = FxHashMap::default();
    for (index, parameter) in function.parameters.iter().enumerate() {
        bind_parameter(parameter, arguments.get(index), &mut bindings)?;
    }
    find_binary_expression_error(&function.body, &bindings)
}

fn find_binary_expression_error(
    expression: &FunctionExpression,
    bindings: &FxHashMap<String, StaticValue>,
) -> Option<String> {
    match expression {
        FunctionExpression::Array { elements } => elements
            .iter()
            .find_map(|element| find_binary_expression_error(element, bindings)),
        FunctionExpression::Binary {
            left,
            operator,
            right,
        } => find_binary_expression_error(left, bindings)
            .or_else(|| find_binary_expression_error(right, bindings))
            .or_else(|| binary_expression_error(left, *operator, right, bindings)),
        FunctionExpression::Conditional {
            test,
            consequent,
            alternate,
        } => find_binary_expression_error(test, bindings).or_else(|| {
            let branch = if static_value_to_boolean(&evaluate_function_expression(test, bindings)?)
            {
                consequent
            } else {
                alternate
            };
            find_binary_expression_error(branch, bindings)
        }),
        FunctionExpression::IsArray { value } => find_binary_expression_error(value, bindings),
        FunctionExpression::Join { array, separator } => {
            find_binary_expression_error(array, bindings)
                .or_else(|| find_binary_expression_error(separator, bindings))
        }
        FunctionExpression::Map {
            array,
            parameter,
            body,
        } => {
            if let Some(error) = find_binary_expression_error(array, bindings) {
                return Some(error);
            }
            let StaticValue::Array(values) = evaluate_function_expression(array, bindings)? else {
                return None;
            };
            values.into_iter().find_map(|value| {
                let mut scoped = bindings.clone();
                scoped.insert(parameter.clone(), value);
                find_binary_expression_error(body, &scoped)
            })
        }
        FunctionExpression::Object { properties } => properties
            .iter()
            .find_map(|property| find_binary_expression_error(&property.value, bindings)),
        FunctionExpression::Template { expressions, .. } => expressions
            .iter()
            .find_map(|value| find_binary_expression_error(value, bindings)),
        FunctionExpression::Boolean { .. }
        | FunctionExpression::Number { .. }
        | FunctionExpression::Parameter { .. }
        | FunctionExpression::String { .. }
        | FunctionExpression::Undefined => None,
    }
}

fn binary_expression_error(
    left: &FunctionExpression,
    operator: FunctionOperator,
    right: &FunctionExpression,
    bindings: &FxHashMap<String, StaticValue>,
) -> Option<String> {
    let left_value = evaluate_function_expression(left, bindings)?;
    let requires_defined_operands = matches!(
        operator,
        FunctionOperator::Addition
            | FunctionOperator::Subtraction
            | FunctionOperator::Multiplication
            | FunctionOperator::Division
    );
    if requires_defined_operands && matches!(left_value, StaticValue::Undefined) {
        return Some(format!(
            "left operand '{}' is undefined",
            expression_label(left)
        ));
    }
    let right_value = evaluate_function_expression(right, bindings)?;
    if requires_defined_operands && matches!(right_value, StaticValue::Undefined) {
        return Some(format!(
            "right operand '{}' is undefined",
            expression_label(right)
        ));
    }
    if matches!(operator, FunctionOperator::Division)
        && matches!(right_value, StaticValue::Number(value) if value == 0.0)
    {
        return Some("division by zero".to_owned());
    }
    if evaluate_binary(left_value, runtime_operator(operator), right_value).is_none() {
        return Some("operands must be numbers".to_owned());
    }
    None
}

fn expression_label(expression: &FunctionExpression) -> &str {
    match expression {
        FunctionExpression::Parameter { name } => name,
        _ => "expression",
    }
}

fn bind_parameter(
    parameter: &FunctionParameter,
    argument: Option<&StaticValue>,
    bindings: &mut FxHashMap<String, StaticValue>,
) -> Option<()> {
    match parameter {
        FunctionParameter::Identifier { name, default } => {
            let value = resolve_default(argument, default.as_ref(), bindings)?;
            bindings.insert(name.clone(), value);
        }
        FunctionParameter::Object {
            properties,
            default,
        } => {
            let value = resolve_default(argument, default.as_ref(), bindings)?;
            let StaticValue::Object(values) = value else {
                return None;
            };
            for property in properties {
                let value = resolve_default(
                    values.get(&property.source),
                    property.default.as_ref(),
                    bindings,
                )?;
                bindings.insert(property.binding.clone(), value);
            }
        }
    }
    Some(())
}

fn resolve_default(
    value: Option<&StaticValue>,
    default: Option<&FunctionExpression>,
    bindings: &FxHashMap<String, StaticValue>,
) -> Option<StaticValue> {
    match value {
        Some(StaticValue::Undefined) | None => default
            .map(|expression| evaluate_function_expression(expression, bindings))
            .unwrap_or(Some(StaticValue::Undefined)),
        Some(value) => Some(value.clone()),
    }
}

fn evaluate_function_expression(
    expression: &FunctionExpression,
    bindings: &FxHashMap<String, StaticValue>,
) -> Option<StaticValue> {
    match expression {
        FunctionExpression::Array { elements } => Some(StaticValue::Array(
            elements
                .iter()
                .map(|element| evaluate_function_expression(element, bindings))
                .collect::<Option<Vec<_>>>()?,
        )),
        FunctionExpression::Boolean { value } => Some(StaticValue::Boolean(*value)),
        FunctionExpression::Number { value } => Some(StaticValue::Number(*value)),
        FunctionExpression::Object { properties } => Some(StaticValue::Object(
            properties
                .iter()
                .map(|property| {
                    Some((
                        property.name.clone(),
                        evaluate_function_expression(&property.value, bindings)?,
                    ))
                })
                .collect::<Option<FxHashMap<_, _>>>()?,
        )),
        FunctionExpression::Parameter { name } => bindings.get(name).cloned(),
        FunctionExpression::String { value } => {
            let mut output = value.clone();
            for (name, binding) in bindings {
                output = output.replace(&format!("${{{name}}}"), &static_value_to_string(binding));
            }
            Some(StaticValue::String(output))
        }
        FunctionExpression::Undefined => Some(StaticValue::Undefined),
        FunctionExpression::Binary {
            left,
            operator,
            right,
        } => evaluate_binary(
            evaluate_function_expression(left, bindings)?,
            runtime_operator(*operator),
            evaluate_function_expression(right, bindings)?,
        ),
        FunctionExpression::Conditional {
            test,
            consequent,
            alternate,
        } => {
            if static_value_to_boolean(&evaluate_function_expression(test, bindings)?) {
                evaluate_function_expression(consequent, bindings)
            } else {
                evaluate_function_expression(alternate, bindings)
            }
        }
        FunctionExpression::IsArray { value } => Some(StaticValue::Boolean(matches!(
            evaluate_function_expression(value, bindings)?,
            StaticValue::Array(_)
        ))),
        FunctionExpression::Join { array, separator } => {
            let StaticValue::Array(values) = evaluate_function_expression(array, bindings)? else {
                return None;
            };
            let separator =
                static_value_to_string(&evaluate_function_expression(separator, bindings)?);
            Some(StaticValue::String(
                values
                    .iter()
                    .map(static_value_to_string)
                    .collect::<Vec<_>>()
                    .join(&separator),
            ))
        }
        FunctionExpression::Map {
            array,
            parameter,
            body,
        } => {
            let StaticValue::Array(values) = evaluate_function_expression(array, bindings)? else {
                return None;
            };
            let mapped = values
                .into_iter()
                .map(|value| {
                    let mut scoped = bindings.clone();
                    scoped.insert(parameter.clone(), value);
                    evaluate_function_expression(body, &scoped)
                })
                .collect::<Option<Vec<_>>>()?;
            Some(StaticValue::Array(mapped))
        }
        FunctionExpression::Template {
            quasis,
            expressions,
        } => {
            let mut output = String::new();
            for (index, quasi) in quasis.iter().enumerate() {
                output.push_str(quasi);
                if let Some(expression) = expressions.get(index) {
                    output.push_str(&static_value_to_string(&evaluate_function_expression(
                        expression, bindings,
                    )?));
                }
            }
            Some(StaticValue::String(output))
        }
    }
}

fn runtime_operator(operator: FunctionOperator) -> BinaryOperator {
    match operator {
        FunctionOperator::Addition => BinaryOperator::Addition,
        FunctionOperator::Subtraction => BinaryOperator::Subtraction,
        FunctionOperator::Multiplication => BinaryOperator::Multiplication,
        FunctionOperator::Division => BinaryOperator::Division,
        FunctionOperator::Equality => BinaryOperator::Equality,
        FunctionOperator::Inequality => BinaryOperator::Inequality,
        FunctionOperator::StrictEquality => BinaryOperator::StrictEquality,
        FunctionOperator::StrictInequality => BinaryOperator::StrictInequality,
    }
}

pub(super) fn evaluate_argument(
    argument: &Argument<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Option<StaticValue> {
    match argument {
        Argument::BooleanLiteral(literal) => Some(StaticValue::Boolean(literal.value)),
        Argument::StringLiteral(literal) => Some(StaticValue::String(literal.value.to_string())),
        Argument::NumericLiteral(literal) => Some(StaticValue::Number(literal.value)),
        Argument::Identifier(identifier) if identifier.name.as_str() == "undefined" => {
            Some(StaticValue::Undefined)
        }
        Argument::Identifier(identifier) => {
            resolved_constant(identifier, constants, scoping).cloned()
        }
        Argument::ArrayExpression(array) => evaluate_array(array, constants, scoping),
        Argument::ObjectExpression(object) => evaluate_object(object, constants, scoping),
        Argument::BinaryExpression(binary) => evaluate_binary(
            evaluate_expression(&binary.left, constants, scoping)?,
            binary.operator,
            evaluate_expression(&binary.right, constants, scoping)?,
        ),
        _ => None,
    }
}
