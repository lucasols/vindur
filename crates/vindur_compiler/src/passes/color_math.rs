// Keep in sync with `lib/src/color-math.ts`, compiled and runtime colors must match

pub(super) type Rgb = (u8, u8, u8);

pub(super) struct Hsl {
    pub hue: f64,
    pub saturation: f64,
    pub lightness: f64,
}

pub(super) const OPTIMAL_CONTRAST_SATURATED_DARKER: f64 = 0.86;

pub(super) fn parse_hex(hex: &str) -> Option<Rgb> {
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

pub(super) fn compress_hex((red, green, blue): Rgb, alpha: Option<u8>) -> String {
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

fn channel(value: f64) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

/// `color-mix(in srgb, color (1 - amount), target)`
pub(super) fn mix((red, green, blue): Rgb, target: f64, amount: f64) -> Rgb {
    let mix_channel = |value: u8| channel(f64::from(value) + (target - f64::from(value)) * amount);
    (mix_channel(red), mix_channel(green), mix_channel(blue))
}

pub(super) fn rgb_to_hsl((red, green, blue): Rgb) -> Hsl {
    let red = f64::from(red) / 255.0;
    let green = f64::from(green) / 255.0;
    let blue = f64::from(blue) / 255.0;
    let max = red.max(green).max(blue);
    let min = red.min(green).min(blue);
    let lightness = (max + min) / 2.0;
    let delta = max - min;
    if delta == 0.0 {
        return Hsl {
            hue: 0.0,
            saturation: 0.0,
            lightness,
        };
    }
    let saturation = delta / (1.0 - (2.0 * lightness - 1.0).abs());
    let hue = if max == red {
        ((green - blue) / delta).rem_euclid(6.0)
    } else if max == green {
        (blue - red) / delta + 2.0
    } else {
        (red - green) / delta + 4.0
    };
    Hsl {
        hue: hue * 60.0,
        saturation,
        lightness,
    }
}

pub(super) fn hsl_to_rgb(hsl: &Hsl) -> Rgb {
    let chroma = (1.0 - (2.0 * hsl.lightness - 1.0).abs()) * hsl.saturation;
    let x = chroma * (1.0 - ((hsl.hue / 60.0) % 2.0 - 1.0).abs());
    let (red, green, blue) = match hsl.hue {
        value if value < 60.0 => (chroma, x, 0.0),
        value if value < 120.0 => (x, chroma, 0.0),
        value if value < 180.0 => (0.0, chroma, x),
        value if value < 240.0 => (0.0, x, chroma),
        value if value < 300.0 => (x, 0.0, chroma),
        _ => (chroma, 0.0, x),
    };
    let offset = hsl.lightness - chroma / 2.0;
    (
        channel((red + offset) * 255.0),
        channel((green + offset) * 255.0),
        channel((blue + offset) * 255.0),
    )
}

/// Saturation is forced to 0% for near grays and 100% otherwise
pub(super) fn saturated_darker_saturation(saturation: f64) -> f64 {
    if saturation < 0.2 { 0.0 } else { 1.0 }
}

/// Lightness goes toward 0% by `amount`, with the forced saturation
pub(super) fn saturated_darker(rgb: Rgb, amount: f64) -> Rgb {
    let hsl = rgb_to_hsl(rgb);
    hsl_to_rgb(&Hsl {
        hue: hsl.hue,
        saturation: saturated_darker_saturation(hsl.saturation),
        lightness: hsl.lightness * (1.0 - amount),
    })
}

fn apca_luminance((red, green, blue): Rgb) -> f64 {
    let linear = |value: u8| (f64::from(value) / 255.0).powf(2.4);
    let luminance =
        0.212_672_9 * linear(red) + 0.715_152_2 * linear(green) + 0.072_175 * linear(blue);
    if luminance < 0.022 {
        luminance + (0.022 - luminance).powf(1.414)
    } else {
        luminance
    }
}

/// APCA lightness contrast (Lc) of `text` over `background`
fn apca_contrast(text: Rgb, background: Rgb) -> f64 {
    let text = apca_luminance(text);
    let background = apca_luminance(background);
    if (background - text).abs() < 0.0005 {
        return 0.0;
    }
    if background > text {
        let contrast = (background.powf(0.56) - text.powf(0.57)) * 1.14;
        if contrast < 0.1 {
            0.0
        } else {
            (contrast - 0.027) * 100.0
        }
    } else {
        let contrast = (background.powf(0.65) - text.powf(0.62)) * 1.14;
        if contrast > -0.1 {
            0.0
        } else {
            (contrast + 0.027) * 100.0
        }
    }
}

/// Whether black text has more APCA contrast than white text on `background`
pub(super) fn prefers_black_text(background: Rgb) -> bool {
    apca_contrast((0, 0, 0), background).abs() > apca_contrast((255, 255, 255), background).abs()
}
