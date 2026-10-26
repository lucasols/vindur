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
use super::static_evaluation::{evaluate_expression, resolved_constant};

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

pub(super) fn invalid_dynamic_color_method_error(
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

pub(super) fn invalid_function_argument_error(
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
    if !matches!(
        resolved_constant(callee, constants, scoping)?,
        StaticValue::Function(_) | StaticValue::ImportedFunction(_)
    ) {
        return None;
    }
    let argument = call
        .arguments
        .iter()
        .find(|argument| evaluate_argument(argument, constants, scoping).is_none())?;
    if let Some(expression) = argument.as_expression()
        && let Some(diagnostic) =
            unevaluable_import_error(expression, constants, scoping, file_path, source)
    {
        return Some(diagnostic);
    }
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        argument.span(),
        format!(
            "Argument of vindurFn \"{}\" can't be evaluated at compile time, only literals, module constants, and arrays or objects of them are supported",
            callee.name
        ),
    ))
}
