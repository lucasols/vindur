use crate::facts::StaticValue;

pub(super) fn dynamic_color_member(value: &StaticValue, property: &str) -> Option<StaticValue> {
    match value {
        StaticValue::DynamicColor { id } => match property {
            "var" => Some(StaticValue::String(format!("var(--{id})"))),
            "contrast" | "self" | "container" => Some(StaticValue::DynamicColorPath {
                id: id.clone(),
                path: property.to_owned(),
            }),
            _ => None,
        },
        StaticValue::DynamicColorPath { id, path } if path == "contrast" && property == "var" => {
            Some(StaticValue::String(format!("var(--{id}-c)")))
        }
        StaticValue::DynamicColorPath { id, path } if path == "self" => {
            selector_index(property).map(|index| StaticValue::String(format!("&.{id}-s{index}")))
        }
        StaticValue::DynamicColorPath { id, path } if path == "container" => {
            selector_index(property).map(|index| StaticValue::String(format!(".{id}-c{index}")))
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
        StaticValue::DynamicColor { id } => (id, false),
        StaticValue::DynamicColorPath { id, path } if path == "contrast" => (id, true),
        _ => return None,
    };
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
        "saturatedDarker" => {
            format!("color-mix(in srgb, {base} {percentage}%, hsl(from {base} h 100% 20%))")
        }
        _ => return None,
    };
    Some(StaticValue::String(value))
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

fn format_percentage(value: f64) -> String {
    let percentage = value * 100.0;
    if percentage.fract() == 0.0 {
        format!("{percentage:.0}")
    } else {
        percentage.to_string()
    }
}
