use oxc_ast::ast::{Argument, BindingPattern, Expression, Statement};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::BinaryOperator;
use rustc_hash::FxHashSet;

pub(super) struct FunctionValidationError {
    pub message: String,
    pub span: Span,
}

pub(super) fn validate_vindur_function(
    name: &str,
    expression: &Expression<'_>,
    source: &str,
) -> Option<FunctionValidationError> {
    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let argument = call.arguments.first()?;
    let (parameters, body, function_span, body_span, is_async, is_generator) = match argument {
        Argument::ArrowFunctionExpression(function) => (
            parameter_names(&function.params.items),
            arrow_body_expression(function),
            function.span,
            function.body.span,
            function.r#async,
            false,
        ),
        Argument::FunctionExpression(function) => {
            let body = function
                .body
                .as_ref()
                .and_then(|body| function_body_expression(&body.statements));
            let body_span = function
                .body
                .as_ref()
                .map_or(function.span, |body| body.span);
            (
                parameter_names(&function.params.items),
                body,
                function.span,
                body_span,
                function.r#async,
                function.generator,
            )
        }
        argument => {
            return Some(FunctionValidationError {
                message: format!(
                    "vindurFn must be called with a function expression, got object in function \"{name}\""
                ),
                span: argument.span(),
            });
        }
    };
    if is_async {
        return Some(FunctionValidationError {
            message: format!(
                "vindurFn \"{name}\" cannot be async - functions must be synchronous for compile-time evaluation"
            ),
            span: function_span,
        });
    }
    if is_generator {
        return Some(FunctionValidationError {
            message: format!(
                "vindurFn \"{name}\" cannot be a generator function - functions must return simple template strings"
            ),
            span: function_span,
        });
    }
    let Some(body) = body else {
        return Some(FunctionValidationError {
            message: format!(
                "vindurFn \"{name}\" body is too complex - functions must contain only a single return statement or be arrow functions with template literals"
            ),
            span: body_span,
        });
    };
    validate_expression(name, body, &parameters, source, ValidationPosition::Body)
}

fn arrow_body_expression<'a>(
    function: &'a oxc_ast::ast::ArrowFunctionExpression<'a>,
) -> Option<&'a Expression<'a>> {
    match function.body.statements.as_slice() {
        [Statement::ExpressionStatement(statement)] => Some(&statement.expression),
        [Statement::ReturnStatement(statement)] => statement.argument.as_ref(),
        _ => None,
    }
}

fn function_body_expression<'a>(statements: &'a [Statement<'a>]) -> Option<&'a Expression<'a>> {
    let [Statement::ReturnStatement(statement)] = statements else {
        return None;
    };
    statement.argument.as_ref()
}

fn parameter_names(parameters: &[oxc_ast::ast::FormalParameter<'_>]) -> FxHashSet<String> {
    let mut names = FxHashSet::default();
    for parameter in parameters {
        collect_binding_names(&parameter.pattern, &mut names);
    }
    names
}

fn collect_binding_names(pattern: &BindingPattern<'_>, names: &mut FxHashSet<String>) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            names.insert(identifier.name.to_string());
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                collect_binding_names(&property.value, names);
            }
        }
        BindingPattern::AssignmentPattern(assignment) => {
            collect_binding_names(&assignment.left, names);
        }
        _ => {}
    }
}

#[derive(Clone, Copy)]
enum ValidationPosition {
    Body,
    ConditionalBranch,
    ConditionalTest,
}

fn validate_expression(
    name: &str,
    expression: &Expression<'_>,
    parameters: &FxHashSet<String>,
    source: &str,
    position: ValidationPosition,
) -> Option<FunctionValidationError> {
    match expression {
        Expression::Identifier(identifier)
            if !parameters.contains(identifier.name.as_str())
                && identifier.name.as_str() != "undefined" =>
        {
            let expression_source =
                &source[expression.span().start as usize..expression.span().end as usize];
            let mut parameter_names = parameters.iter().map(String::as_str).collect::<Vec<_>>();
            parameter_names.sort_unstable();
            let function_context = format!("vindurFn(({}) => ", parameter_names.join(", "));
            Some(FunctionValidationError {
                message: format!(
                    "Invalid interpolation used at `... {name} = {function_context}` ... ${{{expression_source}}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported"
                ),
                span: expression.span(),
            })
        }
        Expression::StaticMemberExpression(member) => {
            if allowed_array_method(member.property.name.as_str()) {
                validate_expression(name, &member.object, parameters, source, position)
            } else {
                Some(FunctionValidationError {
                    message: format!(
                        "vindurFn \"{name}\" contains member expressions which suggest external dependencies - functions must be self-contained"
                    ),
                    span: expression.span(),
                })
            }
        }
        Expression::ComputedMemberExpression(_) => Some(FunctionValidationError {
            message: format!(
                "vindurFn \"{name}\" contains member expressions which suggest external dependencies - functions must be self-contained"
            ),
            span: expression.span(),
        }),
        Expression::CallExpression(call) => validate_call(name, call, parameters, source, position),
        Expression::ConditionalExpression(conditional) => {
            validate_condition(name, &conditional.test, parameters, source)
                .or_else(|| {
                    validate_expression(
                        name,
                        &conditional.consequent,
                        parameters,
                        source,
                        ValidationPosition::ConditionalBranch,
                    )
                })
                .or_else(|| {
                    validate_expression(
                        name,
                        &conditional.alternate,
                        parameters,
                        source,
                        ValidationPosition::ConditionalBranch,
                    )
                })
        }
        Expression::TemplateLiteral(template) => template.expressions.iter().find_map(|value| {
            validate_expression(name, value, parameters, source, ValidationPosition::Body)
        }),
        Expression::BinaryExpression(binary) => {
            validate_expression(name, &binary.left, parameters, source, position)
                .or_else(|| validate_expression(name, &binary.right, parameters, source, position))
        }
        Expression::ParenthesizedExpression(parenthesized) => validate_expression(
            name,
            &parenthesized.expression,
            parameters,
            source,
            position,
        ),
        Expression::ArrayExpression(array) => array.elements.iter().find_map(|element| {
            element
                .as_expression()
                .and_then(|value| validate_expression(name, value, parameters, source, position))
        }),
        Expression::ObjectExpression(object) => object.properties.iter().find_map(|property| {
            let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            validate_expression(name, &property.value, parameters, source, position)
        }),
        Expression::NewExpression(_)
            if matches!(position, ValidationPosition::ConditionalBranch) =>
        {
            Some(FunctionValidationError {
                message: format!(
                    "vindurFn \"{name}\" contains unsupported expression type in ternary: NewExpression"
                ),
                span: expression.span(),
            })
        }
        _ => None,
    }
}

fn validate_condition(
    name: &str,
    expression: &Expression<'_>,
    parameters: &FxHashSet<String>,
    source: &str,
) -> Option<FunctionValidationError> {
    match expression {
        Expression::Identifier(_) | Expression::BooleanLiteral(_) => validate_expression(
            name,
            expression,
            parameters,
            source,
            ValidationPosition::ConditionalTest,
        ),
        Expression::BinaryExpression(binary) => {
            if binary.operator == BinaryOperator::Equality {
                return Some(FunctionValidationError {
                    message: format!(
                        "vindurFn \"{name}\" contains unsupported comparison operator \"==\" - only ===, !==, >, <, >=, <= are supported"
                    ),
                    span: expression.span(),
                });
            }
            if matches!(&binary.left, Expression::BinaryExpression(_))
                || matches!(&binary.right, Expression::BinaryExpression(_))
            {
                return Some(FunctionValidationError {
                    message: format!(
                        "vindurFn \"{name}\" contains unsupported condition value type: BinaryExpression"
                    ),
                    span: expression.span(),
                });
            }
            let unsupported_literal = match (&binary.left, &binary.right) {
                (Expression::ObjectExpression(_), _) | (_, Expression::ObjectExpression(_)) => {
                    Some("ObjectExpression")
                }
                (Expression::ArrayExpression(_), _) | (_, Expression::ArrayExpression(_)) => {
                    Some("ArrayExpression")
                }
                _ => None,
            };
            if let Some(expression_type) = unsupported_literal {
                return Some(FunctionValidationError {
                    message: format!(
                        "vindurFn \"{name}\" contains unsupported condition value type: {expression_type}"
                    ),
                    span: expression.span(),
                });
            }
            validate_expression(
                name,
                &binary.left,
                parameters,
                source,
                ValidationPosition::ConditionalTest,
            )
            .or_else(|| {
                validate_expression(
                    name,
                    &binary.right,
                    parameters,
                    source,
                    ValidationPosition::ConditionalTest,
                )
            })
        }
        Expression::CallExpression(_) => validate_expression(
            name,
            expression,
            parameters,
            source,
            ValidationPosition::ConditionalTest,
        ),
        Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_) => {
            validate_expression(
                name,
                expression,
                parameters,
                source,
                ValidationPosition::ConditionalTest,
            )
        }
        Expression::LogicalExpression(_) => Some(FunctionValidationError {
            message: format!(
                "vindurFn \"{name}\" contains unsupported ternary condition type: LogicalExpression"
            ),
            span: expression.span(),
        }),
        Expression::ObjectExpression(_) => Some(FunctionValidationError {
            message: format!(
                "vindurFn \"{name}\" contains unsupported condition value type: ObjectExpression"
            ),
            span: expression.span(),
        }),
        Expression::ArrayExpression(_) => Some(FunctionValidationError {
            message: format!(
                "vindurFn \"{name}\" contains unsupported condition value type: ArrayExpression"
            ),
            span: expression.span(),
        }),
        _ => None,
    }
}

fn validate_call(
    name: &str,
    call: &oxc_ast::ast::CallExpression<'_>,
    parameters: &FxHashSet<String>,
    source: &str,
    position: ValidationPosition,
) -> Option<FunctionValidationError> {
    if let Expression::StaticMemberExpression(member) = &call.callee
        && (allowed_array_method(member.property.name.as_str())
            || (matches!(&member.object, Expression::Identifier(identifier) if identifier.name.as_str() == "Array")
                && member.property.name.as_str() == "isArray"))
    {
        let is_array_check = matches!(
            &member.object,
            Expression::Identifier(identifier) if identifier.name.as_str() == "Array"
        ) && member.property.name.as_str() == "isArray";
        let receiver_error = if is_array_check {
            None
        } else {
            validate_expression(name, &member.object, parameters, source, position)
        };
        return receiver_error.or_else(|| {
            call.arguments.iter().find_map(|argument| {
                argument.as_expression().and_then(|value| {
                    validate_expression(name, value, parameters, source, position)
                })
            })
        });
    }
    let message = if matches!(position, ValidationPosition::ConditionalBranch) {
        format!(
            "vindurFn \"{name}\" contains unsupported function calls - only array methods like .map() and .join() are supported"
        )
    } else {
        format!(
            "vindurFn \"{name}\" contains function calls which are not supported - functions must be self-contained"
        )
    };
    Some(FunctionValidationError {
        message,
        span: call.span,
    })
}

fn allowed_array_method(name: &str) -> bool {
    matches!(name, "join" | "map")
}
