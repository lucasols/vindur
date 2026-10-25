use oxc_ast::ast::{Argument, Expression};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{
    CompilerDiagnostic,
    facts::{FunctionParameter, StaticValue},
};

use super::static_evaluation::{evaluate_expression, resolved_constant};

pub(super) fn invalid_layer_error(
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
        resolved_constant(callee, constants, scoping),
        Some(StaticValue::LayerFunction)
    ) {
        return None;
    }
    if let [Argument::StringLiteral(name)] = call.arguments.as_slice() {
        if name.value.split('.').all(is_css_identifier) {
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

/// Checks that `name` is a CSS `<ident-token>`: a name start (letter, `_`, non ASCII or an escape),
/// optionally preceded by `-` or `--`, followed by name characters
fn is_css_identifier(name: &str) -> bool {
    let mut chars = name.chars().peekable();
    let mut has_start = false;
    if chars.peek() == Some(&'-') {
        chars.next();
        if chars.peek() == Some(&'-') {
            chars.next();
            has_start = true;
        }
    }
    while let Some(char) = chars.next() {
        let is_name_start = char.is_ascii_alphabetic() || char == '_' || !char.is_ascii();
        let valid = match char {
            '\\' => chars.next().is_some_and(|escaped| escaped != '\n'),
            _ if has_start => is_name_start || char.is_ascii_digit() || char == '-',
            _ => is_name_start,
        };
        if !valid {
            return false;
        }
        has_start = true;
    }
    has_start
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

#[cfg(test)]
mod tests {
    use super::is_css_identifier;

    #[test]
    fn accepts_css_identifiers() {
        for name in ["base", "-moz-x", "--x", "_a1", "théme", "a\\ b", "layer-2"] {
            assert!(is_css_identifier(name), "{name}");
        }
    }

    #[test]
    fn rejects_non_identifiers() {
        for name in ["", "-", "1a", "-1a", "a b", "a}", "a;b", "a{", "a\\"] {
            assert!(!is_css_identifier(name), "{name}");
        }
    }
}
