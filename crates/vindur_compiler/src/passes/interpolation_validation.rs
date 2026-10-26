use oxc_ast::ast::{Argument, Expression};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{
    CompilerDiagnostic,
    facts::{FunctionParameter, StaticValue},
};

use super::css_syntax::is_layer_name;
use super::function_evaluation::evaluate_argument;
use super::static_evaluation::{color_method_amount, evaluate_expression, resolved_constant};

pub(super) fn invalid_layer_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let Expression::CallExpression(call) = expression.without_parentheses() else {
        return None;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    if !matches!(
        resolved_constant(callee, constants, scoping),
        Some(StaticValue::LayerFunction)
    ) {
        return None;
    }
    if let [Argument::StringLiteral(name)] = call.arguments.as_slice() {
        if is_layer_name(&name.value) {
            return None;
        }
        return Some(CompilerDiagnostic::error(
            file_path,
            source,
            name.span,
            format!(
                "Invalid layer name \"{}\", layer names must be CSS identifiers separated by `.`",
                name.value
            ),
        ));
    }
    let span = call.arguments.first().map_or(call.span, GetSpan::span);
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        span,
        "layer() must be called with a string literal layer name".to_owned(),
    ))
}

pub(super) fn invalid_color_method_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
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
    let receiver = evaluate_expression(&callee.object, constants, scoping)?;
    if !matches!(
        receiver,
        StaticValue::DynamicColor { .. }
            | StaticValue::DynamicColorPath { .. }
            | StaticValue::ThemeColor { .. }
            | StaticValue::ThemeColorContrast { .. }
    ) || matches!(
        color_method_amount(&call.arguments, constants, scoping),
        Ok(Some(_))
    ) {
        return None;
    }
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        call.span,
        format!("Method {method} requires a numeric argument"),
    ))
}

pub(super) fn invalid_array_argument_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    let function = match resolved_constant(callee, constants, scoping)? {
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

/// Errors for imported names without a static value, e.g. `export const GAP = rem(4)`
pub(super) fn unevaluable_import_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let message = match resolved_constant(identifier, constants, scoping)? {
        StaticValue::MissingImport {
            imported_name,
            source_path,
        } => format!("\"{imported_name}\" not found in {source_path}"),
        StaticValue::InvalidFunction { source_path }
        | StaticValue::InvalidObject { source_path } => {
            format!(
                "\"{}\" from {source_path} can't be evaluated at compile time, only static values (strings, numbers, and arrays or objects of them) can be used in vindur styles",
                identifier.name
            )
        }
        _ => return None,
    };
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        expression.span(),
        message,
    ))
}

/// Errors for a vindurFn call that can't be evaluated, on the first argument that can't be
/// evaluated or, when all can, on the call
pub(super) fn vindur_function_call_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let Expression::CallExpression(call) = expression else {
        return None;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    let (StaticValue::Function(function) | StaticValue::ImportedFunction(function)) =
        resolved_constant(callee, constants, scoping)?
    else {
        return None;
    };
    for argument in &call.arguments {
        let value = evaluate_argument(argument, constants, scoping);
        if value.as_ref().is_some_and(is_plain_data) {
            continue;
        }
        if value.is_none()
            && let Some(expression) = argument.as_expression()
            && let Some(diagnostic) =
                unevaluable_import_error(expression, constants, scoping, file_path, source)
        {
            return Some(diagnostic);
        }
        let message = if value.is_some() {
            format!(
                "Argument of vindurFn \"{}\" has no CSS value, only literals, module constants, and arrays or objects of them are supported, use `.var` to pass a color",
                callee.name
            )
        } else {
            format!(
                "Argument of vindurFn \"{}\" can't be evaluated at compile time, only literals, module constants, and arrays or objects of them are supported",
                callee.name
            )
        };
        return Some(CompilerDiagnostic::error(
            file_path,
            source,
            argument.span(),
            message,
        ));
    }
    let message = if call.arguments.len() > function.parameters.len() {
        format!(
            "vindurFn \"{}\" accepts {} argument(s) but was called with {}",
            callee.name,
            function.parameters.len(),
            call.arguments.len()
        )
    } else {
        format!(
            "vindurFn \"{}\" can't be evaluated with these arguments, check that they match its parameters",
            callee.name
        )
    };
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        call.span,
        message,
    ))
}

/// Values a vindurFn can receive, colors, functions and layers have no value inside it
fn is_plain_data(value: &StaticValue) -> bool {
    match value {
        StaticValue::Array(values) => values.iter().all(is_plain_data),
        StaticValue::Object(properties) => properties.values().all(is_plain_data),
        StaticValue::ImportedValue { value, .. } => is_plain_data(value),
        StaticValue::DynamicColor { .. }
        | StaticValue::DynamicColorPath { .. }
        | StaticValue::ThemeColor { .. }
        | StaticValue::ThemeColorContrast { .. }
        | StaticValue::ThemeColors(_)
        | StaticValue::UnexportedThemeColors(_)
        | StaticValue::Function(_)
        | StaticValue::ImportedFunction(_)
        | StaticValue::LayerFunction
        | StaticValue::MissingImport { .. }
        | StaticValue::InvalidFunction { .. }
        | StaticValue::InvalidObject { .. }
        | StaticValue::ImportedObject { .. } => false,
        StaticValue::Boolean(_)
        | StaticValue::ClassName(_)
        | StaticValue::CssClass { .. }
        | StaticValue::Keyframes(_)
        | StaticValue::Number(_)
        | StaticValue::String(_)
        | StaticValue::Undefined => true,
    }
}
