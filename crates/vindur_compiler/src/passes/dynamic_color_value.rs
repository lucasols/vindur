use crate::facts::StaticValue;

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
        "saturatedDarker" if !contrast => format!(
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
