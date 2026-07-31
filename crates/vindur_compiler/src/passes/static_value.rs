use oxc_ast::ast::{Argument, Expression, Program, Statement, TemplateLiteral};
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{
    CompilerDiagnostic,
    facts::{FunctionParameter, StaticValue},
};

use super::function_evaluation::{evaluate_argument, function_binary_expression_error};
use super::static_evaluation::{
    collect_declaration_constants, evaluate_expression, static_value_to_string,
};

pub(crate) struct TemplateContext<'a> {
    pub variable_name: Option<&'a str>,
    pub tag_type: &'a str,
}

pub(crate) fn collect_constants(program: &Program<'_>) -> FxHashMap<String, StaticValue> {
    let mut constants = FxHashMap::default();
    for statement in &program.body {
        match statement {
            Statement::VariableDeclaration(declaration) => {
                collect_declaration_constants(declaration, &mut constants);
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(oxc_ast::ast::Declaration::VariableDeclaration(declaration)) =
                    &export.declaration
                {
                    collect_declaration_constants(declaration, &mut constants);
                }
            }
            _ => {}
        }
    }
    constants
}

pub(crate) fn evaluate_template(
    template: &TemplateLiteral<'_>,
    constants: &FxHashMap<String, StaticValue>,
    file_path: &str,
    source: &str,
    context: &TemplateContext<'_>,
) -> Result<String, CompilerDiagnostic> {
    let mut output = String::new();
    let mut previous_was_css_extension = false;
    for (index, quasi) in template.quasis.iter().enumerate() {
        output.push_str(
            quasi
                .value
                .cooked
                .as_ref()
                .unwrap_or(&quasi.value.raw)
                .as_str(),
        );
        let Some(expression) = template.expressions.get(index) else {
            continue;
        };
        if let Some(diagnostic) =
            invalid_dynamic_color_method_error(expression, constants, file_path, source)
        {
            return Err(diagnostic);
        }
        if let Some(diagnostic) = invalid_layer_error(expression, constants, file_path, source) {
            return Err(diagnostic);
        }
        if let Some(diagnostic) =
            invalid_object_access_error(expression, constants, file_path, source, context)
        {
            return Err(diagnostic);
        }
        if matches!(expression, Expression::ArrowFunctionExpression(_))
            && forward_styled_reference(expression).is_none()
        {
            let variable_context = context.variable_name.map_or_else(
                || context.tag_type.to_owned(),
                |name| format!("... {name} = {}", context.tag_type),
            );
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                expression.span(),
                format!(
                    "Invalid arrow function in interpolation at `{variable_context}`. Only simple forward references like ${{() => Component}} are supported"
                ),
            ));
        }
        if let Expression::Identifier(identifier) = expression
            && let Some(StaticValue::MissingImport {
                imported_name,
                source_path,
            }) = constants.get(identifier.name.as_str())
        {
            return Err(CompilerDiagnostic::error(
                source_path,
                source,
                expression.span(),
                format!("Function \"{imported_name}\" not found in {source_path}"),
            ));
        }
        if let Expression::CallExpression(call) = expression
            && let Expression::Identifier(callee) = &call.callee
            && let Some(StaticValue::InvalidFunction { source_path }) =
                constants.get(callee.name.as_str())
        {
            return Err(CompilerDiagnostic::error(
                source_path,
                source,
                expression.span(),
                "called a invalid vindur function, style functions must be defined with \"vindurFn(() => ...)\" function"
                    .to_owned(),
            ));
        }
        if let Expression::CallExpression(call) = expression
            && let Expression::Identifier(callee) = &call.callee
            && let Some(StaticValue::ImportedValue { source_path, .. }) =
                constants.get(callee.name.as_str())
        {
            return Err(CompilerDiagnostic::error(
                source_path,
                source,
                expression.span(),
                "called a invalid vindur function, style functions must be defined with \"vindurFn(() => ...)\" function"
                    .to_owned(),
            ));
        }
        if let Some(message) = binary_expression_error(expression, constants) {
            return Err(CompilerDiagnostic::error(
                file_path,
                source,
                expression.span(),
                format!("Binary expression evaluation failed: {message}"),
            ));
        }
        if let Some(reference) = forward_styled_reference(expression) {
            output.push_str(&format!("__VINDUR_STYLED_REF_{reference}__"));
            continue;
        }
        let Some(value) = evaluate_expression(expression, constants) else {
            if let Some(diagnostic) =
                invalid_array_argument_error(expression, constants, file_path, source)
            {
                return Err(diagnostic);
            }
            return Err(interpolation_error(expression, file_path, source, context));
        };
        if matches!(value, StaticValue::LayerFunction) {
            return Err(interpolation_error(expression, file_path, source, context));
        }
        let followed_by_semicolon = template.quasis.get(index + 1).is_some_and(|next| {
            next.value
                .cooked
                .as_ref()
                .unwrap_or(&next.value.raw)
                .trim_start()
                .starts_with(';')
        });
        let is_css_extension =
            matches!(value, StaticValue::CssClass { .. }) && followed_by_semicolon;
        let static_before_expression = quasi
            .value
            .cooked
            .as_ref()
            .unwrap_or(&quasi.value.raw)
            .trim()
            .trim_matches(';')
            .trim();
        if is_css_extension && (previous_was_css_extension || !static_before_expression.is_empty())
        {
            output.push('\n');
        }
        let value = match &value {
            StaticValue::CssClass { css, .. } if followed_by_semicolon => css.clone(),
            StaticValue::CssClass { name, .. } => format!(".{name}"),
            value => static_value_to_string(value),
        };
        if matches!(expression, Expression::CallExpression(_)) {
            let preserves_boundary = imported_function_preserves_boundary(expression, constants);
            if preserves_boundary && !output.trim_end_matches([' ', '\t']).ends_with("\n\n") {
                output.push('\n');
            }
            output.push_str(value.trim());
            if value.contains(';') && !followed_by_semicolon && preserves_boundary {
                output.push('\n');
            }
        } else {
            output.push_str(&value);
        }
        previous_was_css_extension = is_css_extension;
    }
    Ok(output)
}

fn binary_expression_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
) -> Option<String> {
    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    let function = match constants.get(callee.name.as_str())? {
        StaticValue::Function(function) | StaticValue::ImportedFunction(function) => function,
        _ => return None,
    };
    let arguments = call
        .arguments
        .iter()
        .map(|argument| evaluate_argument(argument, constants))
        .collect::<Option<Vec<_>>>()?;
    function_binary_expression_error(function, &arguments)
}

fn invalid_object_access_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    file_path: &str,
    source: &str,
    context: &TemplateContext<'_>,
) -> Option<CompilerDiagnostic> {
    let Expression::StaticMemberExpression(member) = expression else {
        return None;
    };
    if let Expression::Identifier(root) = &member.object {
        return match constants.get(root.name.as_str())? {
            StaticValue::Object(_) => {
                Some(interpolation_error(expression, file_path, source, context))
            }
            StaticValue::ImportedObject {
                properties,
                source_path,
            } if !properties.contains_key(member.property.name.as_str()) => Some(
                CompilerDiagnostic::error(
                    file_path,
                    source,
                    expression.span(),
                    format!(
                        "Property \"{}\" not found on imported object \"{}\" from {source_path}",
                        member.property.name, root.name
                    ),
                )
                .ignored_in_lint(),
            ),
            StaticValue::MissingImport {
                imported_name,
                source_path,
            } => Some(CompilerDiagnostic::error(
                file_path,
                source,
                expression.span(),
                format!("Object \"{imported_name}\" not found in {source_path}"),
            )),
            StaticValue::InvalidObject { source_path } => Some(CompilerDiagnostic::error(
                file_path,
                source,
                expression.span(),
                format!("Object \"{}\" not found in {source_path}", root.name),
            )),
            _ => None,
        };
    }
    let root_name = member_root_identifier(&member.object)?;
    if !matches!(
        constants.get(&root_name),
        Some(StaticValue::ImportedObject { .. })
    ) {
        return None;
    }
    let expression_source =
        &source[expression.span().start as usize..expression.span().end as usize];
    let variable_context = context.variable_name.map_or_else(
        || context.tag_type.to_owned(),
        |name| format!("... {name} = {}", context.tag_type),
    );
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        expression.span(),
        format!(
            "Nested property access is not supported, only one level property access is allowed at `{variable_context}` ... ${{{expression_source}}}"
        ),
    ))
}

fn member_root_identifier(expression: &Expression<'_>) -> Option<String> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        Expression::StaticMemberExpression(member) => member_root_identifier(&member.object),
        _ => None,
    }
}

fn imported_function_preserves_boundary(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
) -> bool {
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return false;
    };
    let Some(StaticValue::ImportedFunction(function)) = constants.get(callee.name.as_str()) else {
        return false;
    };
    let crate::facts::FunctionExpression::Template { quasis, .. } = &function.body else {
        return false;
    };
    quasis.last().is_some_and(|quasi| quasi.contains('\n'))
}

fn invalid_layer_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    if !matches!(
        constants.get(callee.name.as_str()),
        Some(StaticValue::LayerFunction)
    ) {
        return None;
    }
    if matches!(call.arguments.as_slice(), [Argument::StringLiteral(_)]) {
        return None;
    }
    let span = call.arguments.first().map_or(call.span, GetSpan::span);
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        span,
        "layer() must be called with a string literal layer name".to_owned(),
    ))
}

fn invalid_dynamic_color_method_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let Expression::StaticMemberExpression(callee) = &call.callee else {
        return None;
    };
    let method = callee.property.name.as_str();
    if !matches!(method, "alpha" | "darker" | "lighter" | "saturatedDarker") {
        return None;
    }
    let receiver = evaluate_expression(&callee.object, constants)?;
    if !matches!(
        receiver,
        StaticValue::DynamicColor { .. } | StaticValue::DynamicColorPath { .. }
    ) || matches!(call.arguments.as_slice(), [Argument::NumericLiteral(_)])
    {
        return None;
    }
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        call.span,
        format!("Method {method} requires a numeric argument"),
    ))
}

fn forward_styled_reference<'e>(expression: &'e Expression<'_>) -> Option<&'e str> {
    let Expression::ArrowFunctionExpression(arrow) = expression else {
        return None;
    };
    if !arrow.expression || !arrow.params.items.is_empty() || arrow.params.rest.is_some() {
        return None;
    }
    let [Statement::ExpressionStatement(statement)] = arrow.body.statements.as_slice() else {
        return None;
    };
    let Expression::Identifier(identifier) = &statement.expression else {
        return None;
    };
    Some(identifier.name.as_str())
}

fn invalid_array_argument_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    let function = match constants.get(callee.name.as_str())? {
        StaticValue::Function(function) | StaticValue::ImportedFunction(function) => function,
        _ => return None,
    };
    for (index, argument) in call.arguments.iter().enumerate() {
        let Argument::ArrayExpression(array) = argument else {
            continue;
        };
        let is_valid = array.elements.iter().all(|element| {
            matches!(
                element.as_expression(),
                Some(Expression::StringLiteral(_) | Expression::NumericLiteral(_))
            )
        });
        if is_valid {
            continue;
        }
        let FunctionParameter::Identifier { name, .. } = function.parameters.get(index)? else {
            return None;
        };
        return Some(CompilerDiagnostic::error(
            file_path,
            source,
            array.span,
            format!(
                "Array argument for parameter '{name}' contains non-literal values that cannot be statically analyzed. Arrays must contain only string and number literals."
            ),
        ));
    }
    None
}

fn interpolation_error(
    expression: &Expression<'_>,
    file_path: &str,
    source: &str,
    context: &TemplateContext<'_>,
) -> CompilerDiagnostic {
    let expression_span = expression.span();
    let expression_source = &source[expression_span.start as usize..expression_span.end as usize];
    let variable_context = context.variable_name.map_or_else(
        || context.tag_type.to_owned(),
        |name| format!("... {name} = {}", context.tag_type),
    );

    let (message, ignore_in_lint) = match expression {
        Expression::Identifier(_) => (
            format!(
                "Invalid interpolation used at `{variable_context}` ... ${{{expression_source}}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported"
            ),
            true,
        ),
        Expression::CallExpression(_) => (
            format!(
                "Unresolved function call at `{variable_context}` ... ${{{expression_source}}}, function must be statically analyzable and correctly imported with the configured aliases"
            ),
            false,
        ),
        Expression::BinaryExpression(_) => (
            format!(
                "Unresolved binary expression at `{variable_context}` ... ${{{expression_source}}}, only simple arithmetic with constants is supported"
            ),
            false,
        ),
        _ => (
            format!(
                "Invalid interpolation used at `{variable_context}` ... ${{{expression_source}}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported"
            ),
            false,
        ),
    };
    let diagnostic = CompilerDiagnostic::error(file_path, source, expression_span, message);
    if ignore_in_lint {
        diagnostic.ignored_in_lint()
    } else {
        diagnostic
    }
}
