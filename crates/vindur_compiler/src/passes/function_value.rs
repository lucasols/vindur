use oxc_ast::ast::{Argument, BindingPattern, Expression, FormalParameter, ObjectPropertyKind};
use oxc_syntax::operator::BinaryOperator;

use crate::facts::{
    CompiledFunction, FunctionExpression, FunctionObjectExpressionProperty, FunctionObjectProperty,
    FunctionOperator, FunctionParameter, StaticValue,
};

pub(super) fn compile_vindur_function(expression: &Expression<'_>) -> Option<StaticValue> {
    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    if callee.name.as_str() != "vindurFn" {
        return None;
    }
    let [Argument::ArrowFunctionExpression(function)] = call.arguments.as_slice() else {
        return None;
    };
    let parameters = function
        .params
        .items
        .iter()
        .map(compile_parameter)
        .collect::<Option<Vec<_>>>()?;
    let body = match function.body.statements.as_slice() {
        [oxc_ast::ast::Statement::ExpressionStatement(body)] => &body.expression,
        [oxc_ast::ast::Statement::ReturnStatement(statement)] => statement.argument.as_ref()?,
        _ => return None,
    };
    Some(StaticValue::Function(CompiledFunction {
        parameters,
        body: compile_function_expression(body)?,
    }))
}

fn compile_parameter(parameter: &FormalParameter<'_>) -> Option<FunctionParameter> {
    let default = match &parameter.initializer {
        Some(expression) => Some(compile_function_expression(expression)?),
        None => None,
    };
    match &parameter.pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(FunctionParameter::Identifier {
            name: identifier.name.to_string(),
            default,
        }),
        BindingPattern::ObjectPattern(object) if object.rest.is_none() => {
            let properties = object
                .properties
                .iter()
                .map(|property| {
                    if property.computed {
                        return None;
                    }
                    let source = property.key.static_name()?.into_owned();
                    let (binding, default) = compile_object_binding(&property.value)?;
                    Some(FunctionObjectProperty {
                        source,
                        binding,
                        default,
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            Some(FunctionParameter::Object {
                properties,
                default,
            })
        }
        _ => None,
    }
}

fn compile_object_binding(
    pattern: &BindingPattern<'_>,
) -> Option<(String, Option<FunctionExpression>)> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => Some((identifier.name.to_string(), None)),
        BindingPattern::AssignmentPattern(assignment) => {
            let BindingPattern::BindingIdentifier(identifier) = &assignment.left else {
                return None;
            };
            Some((
                identifier.name.to_string(),
                Some(compile_function_expression(&assignment.right)?),
            ))
        }
        _ => None,
    }
}

fn compile_function_expression(expression: &Expression<'_>) -> Option<FunctionExpression> {
    match expression {
        Expression::BooleanLiteral(literal) => Some(FunctionExpression::Boolean {
            value: literal.value,
        }),
        Expression::StringLiteral(literal) => Some(FunctionExpression::String {
            value: literal.value.to_string(),
        }),
        Expression::NumericLiteral(literal) => Some(FunctionExpression::Number {
            value: literal.value,
        }),
        Expression::Identifier(identifier) if identifier.name.as_str() == "undefined" => {
            Some(FunctionExpression::Undefined)
        }
        Expression::Identifier(identifier) => Some(FunctionExpression::Parameter {
            name: identifier.name.to_string(),
        }),
        Expression::ArrayExpression(array) => Some(FunctionExpression::Array {
            elements: array
                .elements
                .iter()
                .map(|element| compile_function_expression(element.as_expression()?))
                .collect::<Option<Vec<_>>>()?,
        }),
        Expression::ObjectExpression(object) => {
            let properties = object
                .properties
                .iter()
                .map(|property| {
                    let ObjectPropertyKind::ObjectProperty(property) = property else {
                        return None;
                    };
                    if property.computed {
                        return None;
                    }
                    Some(FunctionObjectExpressionProperty {
                        name: property.key.static_name()?.into_owned(),
                        value: compile_function_expression(&property.value)?,
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            Some(FunctionExpression::Object { properties })
        }
        Expression::TemplateLiteral(template) => Some(FunctionExpression::Template {
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
                .collect::<Option<Vec<_>>>()?,
        }),
        Expression::BinaryExpression(binary) => Some(FunctionExpression::Binary {
            left: Box::new(compile_function_expression(&binary.left)?),
            operator: compile_operator(binary.operator)?,
            right: Box::new(compile_function_expression(&binary.right)?),
        }),
        Expression::ParenthesizedExpression(parenthesized) => {
            compile_function_expression(&parenthesized.expression)
        }
        Expression::ConditionalExpression(conditional) => Some(FunctionExpression::Conditional {
            test: Box::new(compile_function_expression(&conditional.test)?),
            consequent: Box::new(compile_function_expression(&conditional.consequent)?),
            alternate: Box::new(compile_function_expression(&conditional.alternate)?),
        }),
        Expression::CallExpression(call) => compile_function_call(call),
        _ => None,
    }
}

fn compile_function_call(call: &oxc_ast::ast::CallExpression<'_>) -> Option<FunctionExpression> {
    let Expression::StaticMemberExpression(member) = &call.callee else {
        return None;
    };
    if let Expression::Identifier(object) = &member.object
        && object.name.as_str() == "Array"
        && member.property.name.as_str() == "isArray"
    {
        let [argument] = call.arguments.as_slice() else {
            return None;
        };
        return Some(FunctionExpression::IsArray {
            value: Box::new(compile_function_expression(argument.as_expression()?)?),
        });
    }
    match member.property.name.as_str() {
        "join" => {
            let [separator] = call.arguments.as_slice() else {
                return None;
            };
            Some(FunctionExpression::Join {
                array: Box::new(compile_function_expression(&member.object)?),
                separator: Box::new(compile_function_expression(separator.as_expression()?)?),
            })
        }
        "map" => {
            let [Argument::ArrowFunctionExpression(function)] = call.arguments.as_slice() else {
                return None;
            };
            let [parameter] = function.params.items.as_slice() else {
                return None;
            };
            let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
                return None;
            };
            let [oxc_ast::ast::Statement::ExpressionStatement(body)] =
                function.body.statements.as_slice()
            else {
                return None;
            };
            Some(FunctionExpression::Map {
                array: Box::new(compile_function_expression(&member.object)?),
                parameter: identifier.name.to_string(),
                body: Box::new(compile_function_expression(&body.expression)?),
            })
        }
        _ => None,
    }
}

fn compile_operator(operator: BinaryOperator) -> Option<FunctionOperator> {
    match operator {
        BinaryOperator::Addition => Some(FunctionOperator::Addition),
        BinaryOperator::Subtraction => Some(FunctionOperator::Subtraction),
        BinaryOperator::Multiplication => Some(FunctionOperator::Multiplication),
        BinaryOperator::Division => Some(FunctionOperator::Division),
        BinaryOperator::Equality => Some(FunctionOperator::Equality),
        BinaryOperator::Inequality => Some(FunctionOperator::Inequality),
        BinaryOperator::StrictEquality => Some(FunctionOperator::StrictEquality),
        BinaryOperator::StrictInequality => Some(FunctionOperator::StrictInequality),
        _ => None,
    }
}
