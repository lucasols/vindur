use oxc_ast::ast::Argument;
use oxc_semantic::Scoping;
use oxc_syntax::operator::BinaryOperator;
use rustc_hash::FxHashMap;

use crate::facts::{
    CompiledFunction, FunctionExpression, FunctionOperator, FunctionParameter, StaticValue,
};

use super::static_evaluation::{
    contains_local_object_member, evaluate_array, evaluate_binary, evaluate_expression,
    evaluate_identifier, evaluate_object, has_css_text, resolved_constant, static_value_to_boolean,
    static_value_to_string,
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

/// Why a vindurFn call can't be evaluated, like an undefined operand or an interpolated value
/// without CSS text
pub(super) fn function_evaluation_error(
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
    find_evaluation_error(&function.body, &bindings)
}

fn find_evaluation_error(
    expression: &FunctionExpression,
    bindings: &FxHashMap<String, StaticValue>,
) -> Option<String> {
    match expression {
        FunctionExpression::Array { elements } => elements
            .iter()
            .find_map(|element| find_evaluation_error(element, bindings)),
        FunctionExpression::Binary {
            left,
            operator,
            right,
        } => find_evaluation_error(left, bindings)
            .or_else(|| find_evaluation_error(right, bindings))
            .or_else(|| {
                binary_expression_error(left, *operator, right, bindings)
                    .map(|message| format!("Binary expression evaluation failed: {message}"))
            }),
        FunctionExpression::Conditional {
            test,
            consequent,
            alternate,
        } => find_evaluation_error(test, bindings).or_else(|| {
            let branch = if static_value_to_boolean(&evaluate_function_expression(test, bindings)?)
            {
                consequent
            } else {
                alternate
            };
            find_evaluation_error(branch, bindings)
        }),
        FunctionExpression::IsArray { value } => find_evaluation_error(value, bindings),
        FunctionExpression::Join { array, separator } => find_evaluation_error(array, bindings)
            .or_else(|| find_evaluation_error(separator, bindings))
            .or_else(|| {
                let StaticValue::Array(values) = evaluate_function_expression(array, bindings)?
                else {
                    return None;
                };
                let separator = evaluate_function_expression(separator, bindings)?;
                values
                    .iter()
                    .filter(|value| !matches!(value, StaticValue::Undefined))
                    .chain([&separator])
                    .any(|value| !has_css_text(value))
                    .then(|| no_css_text_error("a joined array element"))
            }),
        FunctionExpression::Map {
            array,
            parameter,
            body,
        } => {
            if let Some(error) = find_evaluation_error(array, bindings) {
                return Some(error);
            }
            let StaticValue::Array(values) = evaluate_function_expression(array, bindings)? else {
                return None;
            };
            values.into_iter().find_map(|value| {
                let mut scoped = bindings.clone();
                scoped.insert(parameter.clone(), value);
                find_evaluation_error(body, &scoped)
            })
        }
        FunctionExpression::Object { properties } => properties
            .iter()
            .find_map(|property| find_evaluation_error(&property.value, bindings)),
        FunctionExpression::Template { expressions, .. } => expressions.iter().find_map(|value| {
            find_evaluation_error(value, bindings).or_else(|| {
                (!has_css_text(&evaluate_function_expression(value, bindings)?))
                    .then(|| no_css_text_error(&format!("'{}'", expression_label(value))))
            })
        }),
        FunctionExpression::String { value } => {
            interpolated_bindings(value, bindings).find_map(|(name, binding)| {
                (!has_css_text(binding)).then(|| no_css_text_error(&format!("'{name}'")))
            })
        }
        FunctionExpression::Boolean { .. }
        | FunctionExpression::Number { .. }
        | FunctionExpression::Parameter { .. }
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
            | FunctionOperator::LessThan
            | FunctionOperator::LessEqualThan
            | FunctionOperator::GreaterThan
            | FunctionOperator::GreaterEqualThan
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
    if apply_operator(left_value, operator, right_value).is_none() {
        return Some("operands must be numbers".to_owned());
    }
    None
}

fn no_css_text_error(label: &str) -> String {
    format!(
        "vindurFn interpolates {label}, which has no CSS text, undefined, booleans and objects can't be written in styles"
    )
}

/// The parameters a quoted string substitutes, like `size` in `'${size}px'`
fn interpolated_bindings<'b>(
    value: &'b str,
    bindings: &'b FxHashMap<String, StaticValue>,
) -> impl Iterator<Item = (&'b String, &'b StaticValue)> {
    bindings
        .iter()
        .filter(move |(name, _)| value.contains(&format!("${{{name}}}")))
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
            for (name, binding) in interpolated_bindings(value, bindings) {
                if !has_css_text(binding) {
                    return None;
                }
                output = output.replace(&format!("${{{name}}}"), &static_value_to_string(binding));
            }
            Some(StaticValue::String(output))
        }
        FunctionExpression::Undefined => Some(StaticValue::Undefined),
        FunctionExpression::Binary {
            left,
            operator,
            right,
        } => apply_operator(
            evaluate_function_expression(left, bindings)?,
            *operator,
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
            let separator = evaluate_function_expression(separator, bindings)?;
            if !has_css_text(&separator) {
                return None;
            }
            Some(StaticValue::String(
                values
                    .iter()
                    // Like in JS, undefined elements are joined as empty strings
                    .map(|value| match value {
                        StaticValue::Undefined => Some(String::new()),
                        value => has_css_text(value).then(|| static_value_to_string(value)),
                    })
                    .collect::<Option<Vec<_>>>()?
                    .join(&static_value_to_string(&separator)),
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
                    let value = evaluate_function_expression(expression, bindings)?;
                    if !has_css_text(&value) {
                        return None;
                    }
                    output.push_str(&static_value_to_string(&value));
                }
            }
            Some(StaticValue::String(output))
        }
    }
}

fn apply_operator(
    left: StaticValue,
    operator: FunctionOperator,
    right: StaticValue,
) -> Option<StaticValue> {
    let operator = match operator {
        FunctionOperator::Addition => BinaryOperator::Addition,
        FunctionOperator::Subtraction => BinaryOperator::Subtraction,
        FunctionOperator::Multiplication => BinaryOperator::Multiplication,
        FunctionOperator::Division => BinaryOperator::Division,
        FunctionOperator::Equality => BinaryOperator::Equality,
        FunctionOperator::Inequality => BinaryOperator::Inequality,
        FunctionOperator::StrictEquality => BinaryOperator::StrictEquality,
        FunctionOperator::StrictInequality => BinaryOperator::StrictInequality,
        FunctionOperator::LessThan => return compare_numbers(left, right, |l, r| l < r),
        FunctionOperator::LessEqualThan => return compare_numbers(left, right, |l, r| l <= r),
        FunctionOperator::GreaterThan => return compare_numbers(left, right, |l, r| l > r),
        FunctionOperator::GreaterEqualThan => {
            return compare_numbers(left, right, |l, r| l >= r);
        }
    };
    evaluate_binary(left, operator, right)
}

fn compare_numbers(
    left: StaticValue,
    right: StaticValue,
    compare: fn(f64, f64) -> bool,
) -> Option<StaticValue> {
    let (StaticValue::Number(left), StaticValue::Number(right)) = (left, right) else {
        return None;
    };
    Some(StaticValue::Boolean(compare(left, right)))
}

/// Colors and functions are only known by their CSS reads, a function would write placeholders like
/// `[dynamic color]` for them
fn is_function_argument_value(value: &StaticValue) -> bool {
    match value {
        StaticValue::ImportedValue { value, .. } => is_function_argument_value(value),
        StaticValue::Object(properties) | StaticValue::ImportedObject { properties, .. } => {
            properties.values().all(is_function_argument_value)
        }
        StaticValue::DynamicColor { .. }
        | StaticValue::DynamicColorPath { .. }
        | StaticValue::Function(_)
        | StaticValue::ImportedFunction(_)
        | StaticValue::ThemeColor { .. }
        | StaticValue::ThemeColorContrast { .. }
        | StaticValue::ThemeColors { .. }
        | StaticValue::UnexportedThemeColors { .. } => false,
        _ => true,
    }
}

pub(super) fn evaluate_argument(
    argument: &Argument<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Option<StaticValue> {
    if argument
        .as_expression()
        .is_some_and(|expression| contains_local_object_member(expression, constants, scoping))
    {
        return None;
    }
    match argument {
        Argument::BooleanLiteral(literal) => Some(StaticValue::Boolean(literal.value)),
        Argument::StringLiteral(literal) => Some(StaticValue::String(literal.value.to_string())),
        Argument::NumericLiteral(literal) => Some(StaticValue::Number(literal.value)),
        Argument::Identifier(identifier) if identifier.name.as_str() == "undefined" => {
            Some(StaticValue::Undefined)
        }
        Argument::Identifier(identifier) => {
            match resolved_constant(identifier, constants, scoping)? {
                StaticValue::ImportedObject { properties, .. } => {
                    Some(StaticValue::Object(properties.clone()))
                }
                _ => evaluate_identifier(identifier, constants, scoping),
            }
            .filter(is_function_argument_value)
        }
        Argument::ArrayExpression(array) => evaluate_array(array, constants, scoping),
        Argument::ObjectExpression(object) => {
            evaluate_object(object, constants, scoping).filter(is_function_argument_value)
        }
        Argument::BinaryExpression(binary) => evaluate_binary(
            evaluate_expression(&binary.left, constants, scoping)?,
            binary.operator,
            evaluate_expression(&binary.right, constants, scoping)?,
        ),
        // Like other interpolated values, e.g. `-4`, `COLORS.primary`, `` `${SIZE}px` `` or
        // `SIZE as number`
        argument => evaluate_expression(
            argument.as_expression()?.get_inner_expression(),
            constants,
            scoping,
        )
        .filter(is_function_argument_value),
    }
}
