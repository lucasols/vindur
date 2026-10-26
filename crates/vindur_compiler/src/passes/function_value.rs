use oxc_ast::ast::{
    Argument, BindingPattern, CallExpression, Expression, FormalParameter, ObjectPropertyKind,
};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::BinaryOperator;

use crate::facts::{
    CompiledFunction, FunctionExpression, FunctionObjectExpressionProperty, FunctionObjectProperty,
    FunctionOperator, FunctionParameter, StaticValue,
};
use crate::semantic::VindurImports;

use super::static_evaluation::is_prototype_setter;

pub(super) fn compile_vindur_function(
    expression: &Expression<'_>,
    imports: &VindurImports<'_>,
) -> Option<StaticValue> {
    try_compile_vindur_function(expression, imports)?.ok()
}

/// `None` if `expression` is not a vindurFn call, otherwise the compiled function or the
/// span of its first part that can't be compiled
pub(super) fn try_compile_vindur_function(
    expression: &Expression<'_>,
    imports: &VindurImports<'_>,
) -> Option<Result<StaticValue, Span>> {
    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    if !imports.matches_import_or_global(callee, "vindurFn") {
        return None;
    }
    Some(compile_function(call))
}

fn compile_function(call: &CallExpression<'_>) -> Result<StaticValue, Span> {
    let [Argument::ArrowFunctionExpression(function)] = call.arguments.as_slice() else {
        return Err(call.span);
    };
    if let Some(rest) = &function.params.rest {
        return Err(rest.span());
    }
    let parameters = function
        .params
        .items
        .iter()
        .map(compile_parameter)
        .collect::<Result<Vec<_>, _>>()?;
    let body = match function.body.statements.as_slice() {
        [oxc_ast::ast::Statement::ExpressionStatement(body)] if function.expression => {
            &body.expression
        }
        [oxc_ast::ast::Statement::ReturnStatement(statement)] => {
            statement.argument.as_ref().ok_or(statement.span)?
        }
        _ => return Err(function.body.span),
    };
    Ok(StaticValue::Function(CompiledFunction {
        parameters,
        body: compile_function_expression(body)?,
    }))
}

fn compile_parameter(parameter: &FormalParameter<'_>) -> Result<FunctionParameter, Span> {
    let default = match &parameter.initializer {
        Some(expression) => Some(compile_function_expression(expression)?),
        None => None,
    };
    match &parameter.pattern {
        BindingPattern::BindingIdentifier(identifier) => Ok(FunctionParameter::Identifier {
            name: identifier.name.to_string(),
            default,
        }),
        BindingPattern::ObjectPattern(object) if object.rest.is_none() => {
            let properties = object
                .properties
                .iter()
                .map(|property| {
                    if property.computed {
                        return Err(property.span);
                    }
                    let source = property
                        .key
                        .static_name()
                        .ok_or(property.span)?
                        .into_owned();
                    let (binding, default) = compile_object_binding(&property.value)?;
                    Ok(FunctionObjectProperty {
                        source,
                        binding,
                        default,
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(FunctionParameter::Object {
                properties,
                default,
            })
        }
        _ => Err(parameter.span),
    }
}

fn compile_object_binding(
    pattern: &BindingPattern<'_>,
) -> Result<(String, Option<FunctionExpression>), Span> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => Ok((identifier.name.to_string(), None)),
        BindingPattern::AssignmentPattern(assignment) => {
            let BindingPattern::BindingIdentifier(identifier) = &assignment.left else {
                return Err(assignment.left.span());
            };
            Ok((
                identifier.name.to_string(),
                Some(compile_function_expression(&assignment.right)?),
            ))
        }
        _ => Err(pattern.span()),
    }
}

fn compile_function_expression(expression: &Expression<'_>) -> Result<FunctionExpression, Span> {
    match expression {
        Expression::BooleanLiteral(literal) => Ok(FunctionExpression::Boolean {
            value: literal.value,
        }),
        Expression::StringLiteral(literal) => Ok(FunctionExpression::String {
            value: literal.value.to_string(),
        }),
        Expression::NumericLiteral(literal) => Ok(FunctionExpression::Number {
            value: literal.value,
        }),
        Expression::Identifier(identifier) if identifier.name.as_str() == "undefined" => {
            Ok(FunctionExpression::Undefined)
        }
        Expression::Identifier(identifier) => Ok(FunctionExpression::Parameter {
            name: identifier.name.to_string(),
        }),
        Expression::ArrayExpression(array) => Ok(FunctionExpression::Array {
            elements: array
                .elements
                .iter()
                .map(|element| {
                    compile_function_expression(element.as_expression().ok_or(element.span())?)
                })
                .collect::<Result<Vec<_>, _>>()?,
        }),
        Expression::ObjectExpression(object) => {
            let properties = object
                .properties
                .iter()
                .map(|property| {
                    let ObjectPropertyKind::ObjectProperty(property) = property else {
                        return Err(property.span());
                    };
                    if property.computed || is_prototype_setter(property) {
                        return Err(property.span);
                    }
                    Ok(FunctionObjectExpressionProperty {
                        name: property
                            .key
                            .static_name()
                            .ok_or(property.span)?
                            .into_owned(),
                        value: compile_function_expression(&property.value)?,
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(FunctionExpression::Object { properties })
        }
        Expression::TemplateLiteral(template) => Ok(FunctionExpression::Template {
            quasis: template
                .quasis
                .iter()
                .map(|quasi| {
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .unwrap_or(&quasi.value.raw)
                        .to_string()
                })
                .collect(),
            expressions: template
                .expressions
                .iter()
                .map(compile_function_expression)
                .collect::<Result<Vec<_>, _>>()?,
        }),
        Expression::BinaryExpression(binary) => Ok(FunctionExpression::Binary {
            left: Box::new(compile_function_expression(&binary.left)?),
            operator: compile_operator(binary.operator).ok_or(binary.span)?,
            right: Box::new(compile_function_expression(&binary.right)?),
        }),
        Expression::ParenthesizedExpression(parenthesized) => {
            compile_function_expression(&parenthesized.expression)
        }
        // Type annotations have no effect on the evaluated value
        Expression::TSAsExpression(expression) => {
            compile_function_expression(&expression.expression)
        }
        Expression::TSSatisfiesExpression(expression) => {
            compile_function_expression(&expression.expression)
        }
        Expression::TSNonNullExpression(expression) => {
            compile_function_expression(&expression.expression)
        }
        Expression::ConditionalExpression(conditional) => Ok(FunctionExpression::Conditional {
            test: Box::new(compile_function_expression(&conditional.test)?),
            consequent: Box::new(compile_function_expression(&conditional.consequent)?),
            alternate: Box::new(compile_function_expression(&conditional.alternate)?),
        }),
        Expression::CallExpression(call) => compile_function_call(call),
        _ => Err(expression.span()),
    }
}

fn compile_function_call(call: &CallExpression<'_>) -> Result<FunctionExpression, Span> {
    let Expression::StaticMemberExpression(member) = &call.callee else {
        return Err(call.span);
    };
    if let Expression::Identifier(object) = &member.object
        && object.name.as_str() == "Array"
        && member.property.name.as_str() == "isArray"
    {
        let [argument] = call.arguments.as_slice() else {
            return Err(call.span);
        };
        return Ok(FunctionExpression::IsArray {
            value: Box::new(compile_function_expression(
                argument.as_expression().ok_or(argument.span())?,
            )?),
        });
    }
    match member.property.name.as_str() {
        "join" => {
            let [separator] = call.arguments.as_slice() else {
                return Err(call.span);
            };
            Ok(FunctionExpression::Join {
                array: Box::new(compile_function_expression(&member.object)?),
                separator: Box::new(compile_function_expression(
                    separator.as_expression().ok_or(separator.span())?,
                )?),
            })
        }
        "map" => {
            let [Argument::ArrowFunctionExpression(function)] = call.arguments.as_slice() else {
                return Err(call.span);
            };
            if function.r#async {
                return Err(function.span);
            }
            let [parameter] = function.params.items.as_slice() else {
                return Err(function.params.span);
            };
            let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
                return Err(parameter.span);
            };
            if parameter.initializer.is_some() {
                return Err(parameter.span);
            }
            let [oxc_ast::ast::Statement::ExpressionStatement(body)] =
                function.body.statements.as_slice()
            else {
                return Err(function.body.span);
            };
            // A block body without `return` returns undefined
            if !function.expression {
                return Err(function.body.span);
            }
            Ok(FunctionExpression::Map {
                array: Box::new(compile_function_expression(&member.object)?),
                parameter: identifier.name.to_string(),
                body: Box::new(compile_function_expression(&body.expression)?),
            })
        }
        _ => Err(call.span),
    }
}

fn compile_operator(operator: BinaryOperator) -> Option<FunctionOperator> {
    match operator {
        BinaryOperator::Addition => Some(FunctionOperator::Addition),
        BinaryOperator::Subtraction => Some(FunctionOperator::Subtraction),
        BinaryOperator::Multiplication => Some(FunctionOperator::Multiplication),
        BinaryOperator::Division => Some(FunctionOperator::Division),
        BinaryOperator::StrictEquality => Some(FunctionOperator::StrictEquality),
        BinaryOperator::StrictInequality => Some(FunctionOperator::StrictInequality),
        BinaryOperator::LessThan => Some(FunctionOperator::LessThan),
        BinaryOperator::LessEqualThan => Some(FunctionOperator::LessEqualThan),
        BinaryOperator::GreaterThan => Some(FunctionOperator::GreaterThan),
        BinaryOperator::GreaterEqualThan => Some(FunctionOperator::GreaterEqualThan),
        _ => None,
    }
}
