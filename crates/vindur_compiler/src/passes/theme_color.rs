use oxc_ast::ast::{Argument, ObjectPropertyKind};
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::facts::StaticValue;

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
            let raw = value.value.to_ascii_lowercase();
            let Some((red, green, blue)) = parse_hex(&raw) else {
                return Err(ThemeColorParseError {
                    message: format!(
                        "Invalid color \"{}\" for \"{name}\". Theme colors must be valid hex colors without alpha (e.g., \"#ff0000\" or \"#f00\")",
                        value.value
                    ),
                    span: value.span,
                });
            };
            Ok((name, compress_hex(red, green, blue, None)))
        })
        .collect()
}

pub(super) fn theme_member(value: &StaticValue, property: &str) -> Option<StaticValue> {
    match value {
        StaticValue::ThemeColors(colors) | StaticValue::UnexportedThemeColors(colors) => {
            colors.get(property).map(|hex| StaticValue::ThemeColor {
                name: property.to_owned(),
                hex: hex.clone(),
            })
        }
        StaticValue::ThemeColor { name, hex } if property == "var" => {
            Some(StaticValue::String(format!("var(--stc-{name}-var, {hex})")))
        }
        StaticValue::ThemeColor { name, hex } if property == "contrast" => {
            Some(StaticValue::ThemeColorContrast {
                name: name.clone(),
                hex: contrast_hex(hex),
            })
        }
        StaticValue::ThemeColorContrast { name, hex } if property == "var" => Some(
            StaticValue::String(format!("var(--stc-{name}-contrast-var, {hex})")),
        ),
        _ => None,
    }
}

pub(super) fn theme_method(
    receiver: &StaticValue,
    method: &str,
    amount: f64,
) -> Option<StaticValue> {
    let (name, hex, prefix) = match receiver {
        StaticValue::ThemeColor { name, hex } => (name, hex, ""),
        StaticValue::ThemeColorContrast { name, hex } => (name, hex, "contrast-"),
        _ => return None,
    };
    let escaped_amount = amount.to_string().replace('.', "\\.");
    let result = match method {
        "alpha" => alpha_hex(hex, amount),
        "darker" => adjust_lightness(hex, -amount),
        "lighter" => adjust_lightness(hex, amount),
        "saturatedDarker" => adjust_lightness(hex, -amount),
        "optimal" => hex.clone(),
        _ => return None,
    };
    let operation = if method == "optimal" {
        format!("{prefix}optimal")
    } else {
        format!("{prefix}{method}-{escaped_amount}")
    };
    Some(StaticValue::String(format!(
        "var(--stc-{name}-{operation}, {result})"
    )))
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

fn parse_hex(hex: &str) -> Option<(u8, u8, u8)> {
    let value = hex.strip_prefix('#')?;
    let expanded = if value.len() == 3 {
        value
            .chars()
            .flat_map(|character| [character, character])
            .collect()
    } else if value.len() == 6 {
        value.to_owned()
    } else {
        return None;
    };
    Some((
        u8::from_str_radix(&expanded[0..2], 16).ok()?,
        u8::from_str_radix(&expanded[2..4], 16).ok()?,
        u8::from_str_radix(&expanded[4..6], 16).ok()?,
    ))
}

fn contrast_hex(hex: &str) -> String {
    let Some((red, green, blue)) = parse_hex(hex) else {
        return "#fff".to_owned();
    };
    let luminance = 0.299 * f64::from(red) + 0.587 * f64::from(green) + 0.114 * f64::from(blue);
    if luminance > 160.0 { "#000" } else { "#fff" }.to_owned()
}

fn alpha_hex(hex: &str, amount: f64) -> String {
    let Some((red, green, blue)) = parse_hex(hex) else {
        return hex.to_owned();
    };
    let alpha = (amount.clamp(0.0, 1.0) * 255.0).round() as u8;
    compress_hex(red, green, blue, Some(alpha))
}

fn adjust_lightness(hex: &str, amount: f64) -> String {
    let Some((red, green, blue)) = parse_hex(hex) else {
        return hex.to_owned();
    };
    let red = f64::from(red) / 255.0;
    let green = f64::from(green) / 255.0;
    let blue = f64::from(blue) / 255.0;
    let max = red.max(green).max(blue);
    let min = red.min(green).min(blue);
    let mut hue = 0.0;
    let lightness = (max + min) / 2.0;
    let delta = max - min;
    let saturation = if delta == 0.0 {
        0.0
    } else {
        delta / (1.0 - (2.0 * lightness - 1.0).abs())
    };
    if delta != 0.0 {
        hue = if max == red {
            ((green - blue) / delta) % 6.0
        } else if max == green {
            (blue - red) / delta + 2.0
        } else {
            (red - green) / delta + 4.0
        };
        hue *= 60.0;
        if hue < 0.0 {
            hue += 360.0;
        }
    }
    let lightness = (lightness + amount).clamp(0.0, 1.0);
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let x = chroma * (1.0 - ((hue / 60.0) % 2.0 - 1.0).abs());
    let (r1, g1, b1) = match hue {
        value if value < 60.0 => (chroma, x, 0.0),
        value if value < 120.0 => (x, chroma, 0.0),
        value if value < 180.0 => (0.0, chroma, x),
        value if value < 240.0 => (0.0, x, chroma),
        value if value < 300.0 => (x, 0.0, chroma),
        _ => (chroma, 0.0, x),
    };
    let offset = lightness - chroma / 2.0;
    compress_hex(
        ((r1 + offset) * 255.0).round() as u8,
        ((g1 + offset) * 255.0).round() as u8,
        ((b1 + offset) * 255.0).round() as u8,
        None,
    )
}

fn compress_hex(red: u8, green: u8, blue: u8, alpha: Option<u8>) -> String {
    let mut value = format!("{red:02x}{green:02x}{blue:02x}");
    if let Some(alpha) = alpha {
        value.push_str(&format!("{alpha:02x}"));
    }
    let bytes = value.as_bytes();
    if bytes.chunks_exact(2).all(|pair| pair[0] == pair[1]) {
        value = bytes
            .chunks_exact(2)
            .map(|pair| char::from(pair[0]))
            .collect();
    }
    format!("#{value}")
}
