use oxc_ast::ast::Expression;
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{CompilerDiagnostic, facts::StaticValue};

use super::{static_evaluation::evaluate_expression, styled::strip_css_comments};

pub(super) fn dynamic_color_member(value: &StaticValue, property: &str) -> Option<StaticValue> {
    match value {
        StaticValue::DynamicColor { id, dev } => match property {
            "var" => Some(StaticValue::String(format!("var(--{id})"))),
            "contrast" | "self" | "container" => Some(StaticValue::DynamicColorPath {
                id: id.clone(),
                path: property.to_owned(),
                dev: *dev,
            }),
            _ => None,
        },
        StaticValue::DynamicColorPath { id, path, .. }
            if path == "contrast" && property == "var" =>
        {
            Some(StaticValue::String(format!("var(--{id}-c)")))
        }
        StaticValue::DynamicColorPath { id, path, dev } if path == "self" => {
            selector_class_name(id, path, property, *dev)
                .map(|class_name| StaticValue::String(format!("&.{class_name}")))
        }
        StaticValue::DynamicColorPath { id, path, dev } if path == "container" => {
            selector_class_name(id, path, property, *dev)
                .map(|class_name| StaticValue::String(format!(".{class_name}")))
        }
        _ => None,
    }
}

pub(super) fn dynamic_color_method(
    receiver: &StaticValue,
    method: &str,
    amount: Option<f64>,
) -> Option<StaticValue> {
    let (id, contrast) = match receiver {
        StaticValue::DynamicColor { id, .. } => (id, false),
        StaticValue::DynamicColorPath { id, path, .. } if path == "contrast" => (id, true),
        _ => return None,
    };
    if !is_color_method(contrast, method) {
        return None;
    }
    let base = if contrast {
        format!("var(--{id}-c)")
    } else {
        format!("var(--{id})")
    };
    if method == "optimal" {
        return Some(StaticValue::String(amount.map_or_else(
            || format!("var(--{id}-c-optimal)"),
            |amount| {
                format!(
                    "color-mix(in srgb, var(--{id}-c-optimal) {}%, transparent)",
                    format_percentage(amount)
                )
            },
        )));
    }
    let amount = amount?;
    let percentage = format_percentage(if method == "alpha" {
        amount
    } else {
        1.0 - amount
    });
    let value = match method {
        "alpha" => format!("color-mix(in srgb, {base} {percentage}%, transparent)"),
        "darker" => format!("color-mix(in srgb, {base} {percentage}%, #000)"),
        "lighter" => format!("color-mix(in srgb, {base} {percentage}%, #fff)"),
        // Uses the hsl vars set by the runtime, see `saturated_darker` in color_math.rs
        "saturatedDarker" => format!(
            "hsl(var(--{id}-h), var(--{id}-sds), calc(var(--{id}-l) * {}))",
            format_factor(1.0 - amount)
        ),
        _ => return None,
    };
    Some(StaticValue::String(value))
}

/// Matches `getClassName` in lib/src/runtime-colors.ts: readable `{id}-self-isDark` in
/// dev, short `{id}-s0` in production
fn selector_class_name(id: &str, path: &str, property: &str, dev: bool) -> Option<String> {
    let index = selector_index(property)?;
    Some(if dev {
        format!("{id}-{path}-{property}")
    } else {
        let short_path = if path == "self" { "s" } else { "c" };
        format!("{id}-{short_path}{index}")
    })
}

fn selector_index(property: &str) -> Option<u8> {
    match property {
        "isDark" => Some(0),
        "isLight" => Some(1),
        "isDefined" => Some(2),
        "isNotDefined" => Some(3),
        "isVeryDark" => Some(4),
        "isNotVeryDark" => Some(5),
        "isVeryLight" => Some(6),
        "isNotVeryLight" => Some(7),
        _ => None,
    }
}

// Rounded to drop float noise like `1.0 - 0.86 = 0.14000000000000001`
fn format_factor(value: f64) -> String {
    let rounded = (value * 10_000.0).round() / 10_000.0;
    rounded.to_string()
}

fn format_percentage(value: f64) -> String {
    format_factor(value * 100.0)
}

/// `container.*` selectors match an ancestor that sets the color, so a rule selected by
/// one alone styles that ancestor's descendants with the container class instead of this
/// element, e.g. `${color.container.isDark} {` instead of `${color.container.isDark} & {`
pub(super) fn container_selector_error(
    expression: &Expression<'_>,
    surrounding_quasis: (&str, Option<&str>),
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let (previous, next) = surrounding_quasis;
    let previous = strip_css_comments(previous);
    let starts_selector = previous
        .rsplit(['{', '}', ';', ','])
        .next()
        .is_none_or(|selector_start| selector_start.trim().is_empty());
    // The rest of the compound selector, e.g. `:hover` in `${c.container.isDark}:hover {`
    let rest = strip_css_comments(next?.split_once('{')?.0);
    // A leading space is a descendant combinator, so only a trailing one is trimmed
    let compound = rest.split(',').next().unwrap_or_default().trim_end();
    if !starts_selector
        || compound.contains('&')
        || compound.contains(|character: char| {
            character.is_whitespace() || matches!(character, '>' | '+' | '~')
        })
    {
        return None;
    }
    let Expression::StaticMemberExpression(member) = expression.without_parentheses() else {
        return None;
    };
    let Some(StaticValue::DynamicColorPath { path, .. }) =
        evaluate_expression(&member.object, constants, scoping)
    else {
        return None;
    };
    if path != "container" {
        return None;
    }
    let span = expression.span();
    let selector = &source[span.start as usize..span.end as usize];
    Some(CompilerDiagnostic::error(
        file_path,
        source,
        span,
        format!(
            "`${{{selector}}}` matches an ancestor that sets the color. Use `${{{selector}}} & {{ ... }}` to style this element, or `& ${{{selector}}} {{ ... }}` to style descendants that set the color"
        ),
    ))
}

/// A color object interpolated as is would print a placeholder instead of a CSS value
pub(super) fn color_interpolation_error(
    value: &StaticValue,
    expression: &Expression<'_>,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let span = expression.span();
    let interpolation = &source[span.start as usize..span.end as usize];
    let message = match value {
        StaticValue::ThemeColors(_) | StaticValue::UnexportedThemeColors(_) => format!(
            "`${{{interpolation}}}` is a color palette, not a CSS value. Use one of its colors, e.g. `${{{interpolation}.name.var}}`"
        ),
        StaticValue::DynamicColorPath { path, .. } if path != "contrast" => format!(
            "`${{{interpolation}}}` is a group of selectors, not a CSS value. Use one of them, e.g. `${{{interpolation}.isDark}}`"
        ),
        StaticValue::DynamicColor { .. }
        | StaticValue::DynamicColorPath { .. }
        | StaticValue::ThemeColor { .. }
        | StaticValue::ThemeColorContrast { .. } => format!(
            "`${{{interpolation}}}` is a color, not a CSS value. Use its `.var` or a color method, e.g. `${{{interpolation}.var}}`"
        ),
        _ => return None,
    };
    Some(CompilerDiagnostic::error(file_path, source, span, message))
}

/// The methods each kind of color has at runtime, see `ColorOps` and `ContrastOps` in
/// lib/src/runtime-colors.ts
pub(super) fn is_color_method(contrast: bool, method: &str) -> bool {
    if contrast {
        matches!(method, "alpha" | "optimal")
    } else {
        matches!(method, "alpha" | "darker" | "lighter" | "saturatedDarker")
    }
}

/// Amounts outside 0-1 make invalid CSS, the types can't reject them. Other misuse, like a
/// missing argument or a method the color doesn't have, is a type error and fails as an invalid
/// interpolation
pub(super) fn invalid_color_method_error(
    expression: &Expression<'_>,
    constants: &FxHashMap<String, StaticValue>,
    scoping: &Scoping,
    file_path: &str,
    source: &str,
) -> Option<CompilerDiagnostic> {
    let Expression::CallExpression(call) = expression.without_parentheses() else {
        return None;
    };
    let Expression::StaticMemberExpression(callee) = &call.callee else {
        return None;
    };
    let method = callee.property.name.as_str();
    if !matches!(
        method,
        "alpha" | "darker" | "lighter" | "saturatedDarker" | "optimal"
    ) || !matches!(
        evaluate_expression(&callee.object, constants, scoping)?,
        StaticValue::DynamicColor { .. }
            | StaticValue::DynamicColorPath { .. }
            | StaticValue::ThemeColor { .. }
            | StaticValue::ThemeColorContrast { .. }
    ) {
        return None;
    }
    let [argument] = call.arguments.as_slice() else {
        return None;
    };
    let argument = evaluate_expression(argument.as_expression()?, constants, scoping)?;
    let (name, amount) = match (method, argument) {
        (
            "optimal",
            StaticValue::Object(properties) | StaticValue::ImportedObject { properties, .. },
        ) => match properties.get("alpha") {
            Some(StaticValue::Number(alpha)) => ("optimal alpha".to_owned(), *alpha),
            _ => return None,
        },
        (_, StaticValue::Number(amount)) => (format!("{method} amount"), amount),
        _ => return None,
    };
    (!(0.0..=1.0).contains(&amount)).then(|| {
        CompilerDiagnostic::error(
            file_path,
            source,
            call.span,
            format!("Method {name} must be between 0 and 1, got {amount}"),
        )
    })
}
