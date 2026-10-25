use oxc_ast::ast::{Argument, ObjectPropertyKind};
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::facts::StaticValue;

use super::{
    color_math::{
        OPTIMAL_CONTRAST_SATURATED_DARKER, compress_hex, mix, parse_hex, prefers_black_text,
        saturated_darker,
    },
    dynamic_color_value::is_color_method,
};

pub(super) struct ThemeColorParseError {
    pub message: String,
    pub span: oxc_span::Span,
}

pub(super) fn parse_theme_colors(
    arguments: &[Argument<'_>],
) -> Result<FxHashMap<String, String>, ThemeColorParseError> {
    let [Argument::ObjectExpression(object)] = arguments else {
        return Err(ThemeColorParseError {
            message: "createStaticThemeColors must be called with an object literal".to_owned(),
            span: arguments
                .first()
                .map_or(oxc_span::Span::new(0, 0), GetSpan::span),
        });
    };
    object
        .properties
        .iter()
        .map(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return Err(ThemeColorParseError {
                    message: "createStaticThemeColors object must only contain string properties".to_owned(),
                    span: property.span(),
                });
            };
            let Some(name) = property.key.static_name().map(|name| name.into_owned()) else {
                return Err(ThemeColorParseError {
                    message: "createStaticThemeColors object must only contain string properties".to_owned(),
                    span: property.span,
                });
            };
            let oxc_ast::ast::Expression::StringLiteral(value) = &property.value else {
                return Err(ThemeColorParseError {
                    message: "createStaticThemeColors object must only contain string properties".to_owned(),
                    span: property.span,
                });
            };
            if normalized_hex(&value.value).is_none() {
                return Err(ThemeColorParseError {
                    message: format!(
                        "Invalid color \"{}\" for \"{name}\". Theme colors must be valid hex colors without alpha (e.g., \"#ff0000\" or \"#f00\")",
                        value.value
                    ),
                    span: value.span,
                });
            }
            Ok((name, value.value.to_string()))
        })
        .collect()
}

fn normalized_hex(raw: &str) -> Option<String> {
    parse_hex(&raw.to_ascii_lowercase()).map(|rgb| compress_hex(rgb, None))
}

pub(super) fn theme_member(value: &StaticValue, property: &str) -> Option<StaticValue> {
    match value {
        StaticValue::ThemeColors(colors) | StaticValue::UnexportedThemeColors(colors) => {
            let default_hex = colors.get(property)?;
            Some(StaticValue::ThemeColor {
                name: property.to_owned(),
                hex: normalized_hex(default_hex)?,
                default_hex: default_hex.clone(),
            })
        }
        // The runtime `defaultHex` is the hex as written
        StaticValue::ThemeColor { default_hex, .. } if property == "defaultHex" => {
            Some(StaticValue::String(default_hex.clone()))
        }
        StaticValue::ThemeColor { name, hex, .. } if property == "var" => Some(
            StaticValue::String(format!("var(--stc-{}-var, {hex})", css_name(name))),
        ),
        StaticValue::ThemeColor { name, hex, .. } if property == "contrast" => {
            Some(StaticValue::ThemeColorContrast {
                name: name.clone(),
                hex: contrast_hex(hex),
                base_hex: hex.clone(),
            })
        }
        StaticValue::ThemeColorContrast { name, hex, .. } if property == "var" => Some(
            StaticValue::String(format!("var(--stc-{}-contrast-var, {hex})", css_name(name))),
        ),
        _ => None,
    }
}

pub(super) fn theme_method(
    receiver: &StaticValue,
    method: &str,
    amount: Option<f64>,
) -> Option<StaticValue> {
    let (name, hex, prefix) = match receiver {
        StaticValue::ThemeColor { name, hex, .. } => (name, hex, ""),
        StaticValue::ThemeColorContrast { name, hex, .. } => (name, hex, "contrast-"),
        _ => return None,
    };
    if !is_color_method(!prefix.is_empty(), method) {
        return None;
    }
    let rgb = parse_hex(hex)?;
    let (result, amount) = match method {
        "optimal" => {
            let StaticValue::ThemeColorContrast { base_hex, .. } = receiver else {
                return None;
            };
            let optimal = optimal_contrast_hex(base_hex)?;
            match amount {
                Some(alpha) => (alpha_hex(parse_hex(&optimal)?, alpha), Some(alpha)),
                None => (optimal, None),
            }
        }
        _ => {
            let amount = amount?;
            let result = match method {
                "alpha" => alpha_hex(rgb, amount),
                "darker" => compress_hex(mix(rgb, 0.0, amount), None),
                "lighter" => compress_hex(mix(rgb, 255.0, amount), None),
                "saturatedDarker" => compress_hex(saturated_darker(rgb, amount), None),
                _ => return None,
            };
            (result, Some(amount))
        }
    };
    let operation = amount.map_or_else(
        || format!("{prefix}{method}"),
        |amount| {
            let escaped_amount = amount.to_string().replace('.', "\\.");
            format!("{prefix}{method}-{escaped_amount}")
        },
    );
    Some(StaticValue::String(format!(
        "var(--stc-{}-{operation}, {result})",
        css_name(name)
    )))
}

/// Theme color keys can have characters like `$` that are invalid in a custom property name
fn css_name(name: &str) -> String {
    name.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn contrast_hex(hex: &str) -> String {
    let prefers_black = parse_hex(hex).is_some_and(prefers_black_text);
    if prefers_black { "#000" } else { "#fff" }.to_owned()
}

// Light backgrounds use a saturated dark variant instead of plain black
fn optimal_contrast_hex(base_hex: &str) -> Option<String> {
    let rgb = parse_hex(base_hex)?;
    Some(if prefers_black_text(rgb) {
        compress_hex(
            saturated_darker(rgb, OPTIMAL_CONTRAST_SATURATED_DARKER),
            None,
        )
    } else {
        "#fff".to_owned()
    })
}

fn alpha_hex(rgb: (u8, u8, u8), amount: f64) -> String {
    let alpha = (amount.clamp(0.0, 1.0) * 255.0).round() as u8;
    compress_hex(rgb, Some(alpha))
}

pub(super) fn static_color_fallbacks(css: &str) -> String {
    let mut output = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("var(--stc-") {
        output.push_str(&rest[..start]);
        let Some(comma) = rest[start..].find(", ").map(|index| start + index) else {
            output.push_str(&rest[start..]);
            return output;
        };
        let Some(end) = rest[comma + 2..].find(')').map(|index| comma + 2 + index) else {
            output.push_str(&rest[start..]);
            return output;
        };
        output.push_str(&rest[comma + 2..end]);
        rest = &rest[end + 1..];
    }
    output.push_str(rest);
    output
}
