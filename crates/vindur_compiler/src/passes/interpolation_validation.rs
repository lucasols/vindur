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
use super::import_errors::unresolved_import_error;
use super::scoped_idents::{first_quoted_scoped_name, first_scoped_ident};
use super::static_evaluation::{evaluate_expression, resolved_constant};

/// Scoped variables must be written in the template text, values interpolated from constants or
/// vindurFn calls can't add them. That includes quoted names, like `"---brand"` in a font family,
/// which are renamed too
pub(super) fn interpolated_scoped_variable_error(
    value: &str,
    expression: &Expression<'_>,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let name = first_scoped_ident(value).or_else(|| first_quoted_scoped_name(value))?;
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
/// the rest would be compiled as CSS. A value also can't start or end a comment or an escape
/// together with the template text, like `*` in `/* ${x}/ ... */`
pub(super) fn open_token_end_error(
    css_before: &str,
    value: &str,
    css_after: &str,
    open_token: OpenToken,
    expression: &Expression<'_>,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    // An odd `\` at the end escapes the next character, like a closing quote
    let ends_with_escape = value
        .chars()
        .rev()
        .take_while(|character| *character == '\\')
        .count()
        % 2
        == 1;
    let message = match open_token {
        OpenToken::None => {
            let opens_comment = (value.ends_with('/') && css_after.starts_with('*'))
                || (css_before.ends_with('/') && value.starts_with('*'));
            (opens_comment || ends_with_escape).then(|| {
                "Interpolated values can't end with `\\`, or start a CSS comment together with the template text, like `/` followed by `*`".to_owned()
            })
        }
        OpenToken::String(quote) => (value.contains([quote, '\n', '\r', '\x0c']) || ends_with_escape)
            .then(|| {
                format!(
                    "Values interpolated in a CSS string can't contain `{quote}` or a line break, or end with `\\`, as they would end the string"
                )
            }),
        OpenToken::Comment => {
            // The comment text written before the value, without its `/*`
            let comment_before = css_before
                .rfind("/*")
                .map_or(css_before, |start| &css_before[start + 2..]);
            let ends_comment = value.contains("*/")
                || (value.ends_with('*') && css_after.starts_with('/'))
                || (comment_before.ends_with('*') && value.starts_with('/'));
            ends_comment.then(|| {
                "Values interpolated in a CSS comment can't contain `*/`, or end the comment together with the template text, like `*` followed by `/`".to_owned()
            })
        }
    }?;
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        expression.span(),
        message,
    ))
}

/// A scoped name joined from the template text and an interpolated value, like `---${name}`,
/// `-${'--gap'}`, `${'---'}gap` or `--${''}-gap`, would only be a scoped name after evaluation,
/// so it is never renamed consistently
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
    let joins_after = {
        let joined = format!("{css_before}{value}");
        let end = trailing_ident(&joined);
        // An empty value joins the text around it
        (end.len() > before.len() || (value.is_empty() && !before.is_empty()))
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
                unresolved_import_error(expression, constants, scoping, file_path, source)
        {
            return Some(diagnostic);
        }
        // Css styles are rejected by `evaluate_argument`, they are only known by their value here
        let is_css_style = argument
            .as_expression()
            .and_then(|expression| {
                evaluate_expression(expression.get_inner_expression(), constants, scoping)
            })
            .is_some_and(|value| is_css_class(&value));
        let message = if is_css_style {
            format!(
                "Argument of vindurFn \"{}\" is a css style, which can't be passed to a vindurFn, extend it in the calling template with `${{style}};` instead",
                callee.name
            )
        } else if value.is_some() {
            format!(
                "Argument of vindurFn \"{}\" has no CSS value, only literals, module constants, and arrays or objects of them are supported, use `.value` to pass a color",
                callee.name
            )
        } else {
            "vindurFn arguments must be static values: literals, module level constants, string or number properties of constant objects, or arrays and objects of them. Colors, functions and runtime values can't be passed".to_owned()
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
    } else if function
        .parameters
        .iter()
        .skip(call.arguments.len())
        .any(|parameter| {
            matches!(
                parameter,
                FunctionParameter::Identifier { default: None, .. }
            )
        })
    {
        format!(
            "vindurFn \"{}\" was called with {} of its {} argument(s), a missing argument is undefined and can't be used in CSS, pass it or give its parameter a default",
            callee.name,
            call.arguments.len(),
            function.parameters.len()
        )
    } else {
        format!(
            "vindurFn \"{}\" can't be evaluated with these arguments, check that they match its parameters",
            callee.name
        )
    };
    Some(CompilerDiagnostic::error(
        file_path, source, call.span, message,
    ))
}

fn is_css_class(value: &StaticValue) -> bool {
    match value {
        StaticValue::CssClass { .. } => true,
        StaticValue::ImportedValue { value, .. } => is_css_class(value),
        _ => false,
    }
}

/// Values a vindurFn can receive, colors, css styles, functions and layers have no value inside it
fn is_plain_data(value: &StaticValue) -> bool {
    match value {
        StaticValue::Array(values) => values.iter().all(is_plain_data),
        StaticValue::Object(properties) => properties.values().all(is_plain_data),
        StaticValue::ImportedValue { value, .. } => is_plain_data(value),
        StaticValue::DynamicColor { .. }
        | StaticValue::DynamicColorPath { .. }
        | StaticValue::ThemeColor { .. }
        | StaticValue::ThemeColorContrast { .. }
        | StaticValue::ThemeColors { .. }
        | StaticValue::UnexportedThemeColors { .. }
        | StaticValue::Function(_)
        | StaticValue::ImportedFunction(_)
        | StaticValue::LayerFunction
        | StaticValue::CyclicImport { .. }
        | StaticValue::MissingImport { .. }
        | StaticValue::UnsupportedReExport { .. }
        | StaticValue::InvalidFunction { .. }
        | StaticValue::InvalidObject { .. }
        | StaticValue::ImportedObject { .. }
        | StaticValue::CssClass { .. } => false,
        StaticValue::Boolean(_)
        | StaticValue::ClassName { .. }
        | StaticValue::Keyframes(_)
        | StaticValue::Number(_)
        | StaticValue::String(_)
        | StaticValue::Undefined => true,
    }
}
