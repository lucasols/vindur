use oxc_ast::ast::{Argument, Expression};
use oxc_semantic::Scoping;
use oxc_syntax::operator::BinaryOperator;
use rustc_hash::FxHashMap;

use crate::facts::{
    CompiledFunction, FunctionExpression, FunctionOperator, FunctionParameter, StaticValue,
};

use super::static_evaluation::{
    evaluate_binary, evaluate_expression, has_css_text, resolved_constant, static_value_to_boolean,
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
                // Like in JS, undefined elements are joined as empty strings and an undefined
                // separator joins with commas
                values
                    .iter()
                    .chain([&separator])
                    .filter(|value| !matches!(value, StaticValue::Undefined))
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
    let is_string_concatenation = matches!(operator, FunctionOperator::Addition)
        && (matches!(left_value, StaticValue::String(_))
            || matches!(right_value, StaticValue::String(_)));
    if apply_operator(left_value, operator, right_value).is_none() {
        return Some(
            if matches!(
                operator,
                FunctionOperator::StrictEquality | FunctionOperator::StrictInequality
            ) {
                "only strings, numbers, booleans and undefined can be compared"
            } else if is_string_concatenation {
                "strings can only be concatenated with other strings, use a template literal instead, e.g. `${size}px`"
            } else {
                "operands must be numbers"
            }
            .to_owned(),
        );
    }
    None
}

fn no_css_text_error(label: &str) -> String {
    format!(
        "vindurFn interpolates {label}, which has no CSS text, undefined, booleans and objects can't be written in styles"
    )
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
        FunctionExpression::String { value } => Some(StaticValue::String(value.clone())),
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
            // Like in JS, an undefined separator joins with commas
            let separator = match evaluate_function_expression(separator, bindings)? {
                StaticValue::Undefined => ",".to_owned(),
                separator if has_css_text(&separator) => static_value_to_string(&separator),
                _ => return None,
            };
            Some(StaticValue::String(
                values
                    .iter()
                    // Like in JS, undefined elements are joined as empty strings
                    .map(|value| match value {
                        StaticValue::Undefined => Some(String::new()),
                        value => has_css_text(value).then(|| static_value_to_string(value)),
                    })
                    .collect::<Option<Vec<_>>>()?
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
/// `[dynamic color]` for them. A css style is a selector or its styles depending on where it's
/// interpolated, only vindur templates can tell which
fn is_function_argument_value(value: &StaticValue) -> bool {
    match value {
        StaticValue::ImportedValue { value, .. } => is_function_argument_value(value),
        StaticValue::Object(properties) | StaticValue::ImportedObject { properties, .. } => {
            properties.values().all(is_function_argument_value)
        }
        StaticValue::CssClass { .. }
        | StaticValue::DynamicColor { .. }
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

fn is_primitive(value: &StaticValue) -> bool {
    match value {
        StaticValue::Boolean(_)
        | StaticValue::Number(_)
        | StaticValue::String(_)
        | StaticValue::Undefined => true,
        StaticValue::ImportedValue { value, .. } => is_primitive(value),
        _ => false,
    }
}

pub(super) fn evaluate_argument(
    argument: &Argument<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
) -> Option<StaticValue> {
    // Like other interpolated values, e.g. `-4`, `COLORS.primary`, `` `${SIZE}px` `` or
    // `SIZE as number`
    let expression = argument.as_expression()?.get_inner_expression();
    // Imported objects are passed by value so they can be destructured
    if let Expression::Identifier(identifier) = expression
        && let Some(StaticValue::ImportedObject { properties, .. }) =
            resolved_constant(identifier, constants, scoping)
    {
        let value = StaticValue::Object(properties.clone());
        return is_function_argument_value(&value).then_some(value);
    }
    if let Expression::BinaryExpression(binary) = expression {
        return evaluate_binary(
            evaluate_expression(&binary.left, constants, scoping)?,
            binary.operator,
            evaluate_expression(&binary.right, constants, scoping)?,
        );
    }
    let value = evaluate_expression(expression, constants, scoping)?;
    // Properties of constant objects, like `iconColor.var` or `theme.spacing.md`, must be
    // primitives
    if expression.is_member_expression() {
        is_primitive(&value).then_some(value)
    } else {
        is_function_argument_value(&value).then_some(value)
    }
}
