use oxc_ast::ast::{Argument, Expression};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{
    CompilerDiagnostic,
    facts::{FunctionParameter, StaticValue},
};

use super::css_syntax::is_layer_name;
use super::css_tokens::{OpenToken, is_ident_char};
use super::function_evaluation::evaluate_argument;
use super::id_order::ends_with_scoped_prefix;
use super::scoped_idents::first_scoped_ident;
use super::static_evaluation::resolved_constant;

/// Scoped variables must be written in the template text, values interpolated from constants or
/// vindurFn calls can't add them
pub(super) fn interpolated_scoped_variable_error(
    value: &str,
    expression: &Expression<'_>,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let name = first_scoped_ident(value)?;
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        expression.span(),
        format!(
            "Interpolated values can't contain scoped variables like \"{name}\", write scoped variables directly in the template"
        ),
    ))
}

/// A value interpolated in a string or comment can't end it, like `a" b: c` in `content: "${x}"`,
/// the rest would be compiled as CSS
pub(super) fn open_token_end_error(
    value: &str,
    open_token: OpenToken,
    expression: &Expression<'_>,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let message = match open_token {
        OpenToken::None => return None,
        OpenToken::String(quote) => (value.contains([quote, '\n', '\r', '\x0c'])
            // An odd `\` at the end escapes the closing quote
            || value.chars().rev().take_while(|character| *character == '\\').count() % 2 == 1)
        .then(|| {
            format!(
                "Values interpolated in a CSS string can't contain `{quote}` or a line break, or end with `\\`, as they would end the string"
            )
        }),
        OpenToken::Comment => value
            .contains("*/")
            .then(|| "Values interpolated in a CSS comment can't contain `*/`".to_owned()),
    }?;
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        expression.span(),
        message,
    ))
}

/// A scoped name joined from the template text and an interpolated value, like `---${name}`,
/// `-${'--gap'}` or `${'---'}gap`, would only be a scoped name after evaluation, so it is never
/// renamed consistently
pub(super) fn joined_scoped_name_error(
    css_before: &str,
    value: &str,
    css_after: &str,
    expression: &Expression<'_>,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let before = trailing_ident(css_before);
    let joins_before = ends_with_scoped_prefix(css_before)
        || (!before.is_empty() && format!("{before}{}", leading_ident(value)).starts_with("---"));
    let joins_after = !value.is_empty() && {
        let joined = format!("{css_before}{value}");
        let end = trailing_ident(&joined);
        end.len() > before.len()
            && !leading_ident(css_after).is_empty()
            && format!("{end}{}", leading_ident(css_after)).starts_with("---")
    };
    (joins_before || joins_after).then(|| {
        CompilerDiagnostic::error(
            file_path,
            source,
            expression.span(),
            "Scoped variable names can't contain interpolations, write the whole name in the template, e.g. `---gap`".to_owned(),
        )
    })
}

fn trailing_ident(text: &str) -> &str {
    let start = text
        .char_indices()
        .rev()
        .take_while(|(_, character)| is_ident_char(*character))
        .last()
        .map_or(text.len(), |(start, _)| start);
    &text[start..]
}

fn leading_ident(text: &str) -> &str {
    let end = text
        .char_indices()
        .find(|(_, character)| !is_ident_char(*character))
        .map_or(text.len(), |(end, _)| end);
    &text[..end]
}

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

/// A vindurFn argument that can't be evaluated at compile time, like a runtime value, a color or a
/// function
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
    let (StaticValue::Function(_) | StaticValue::ImportedFunction(_)) =
        resolved_constant(callee, constants, scoping)?
    else {
        return None;
    };
    let argument = call
        .arguments
        .iter()
        .find(|argument| evaluate_argument(argument, constants, scoping).is_none())?;
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        argument.span(),
        "vindurFn arguments must be static values: literals, module level constants, or arrays and objects of them. Colors, functions and runtime values can't be passed".to_owned(),
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
