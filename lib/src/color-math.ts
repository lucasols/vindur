// Keep in sync with `crates/vindur_compiler/src/passes/color_math.rs`,
// compiled and runtime colors must match

export type Rgb = { r: number; g: number; b: number };

export type Hsl = { h: number; s: number; l: number };

export const OPTIMAL_CONTRAST_SATURATED_DARKER = 0.86;

const HEX_RE = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;

export function parseHex(hex: string): Rgb | null {
  if (!HEX_RE.test(hex)) return null;
  const value =
    hex.length === 4 ?
      [...hex.slice(1)].map((character) => character + character).join('')
    : hex.slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function channel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function toHex({ r, g, b }: Rgb, alpha: number | null = null): string {
  const pairs = [r, g, b, ...(alpha === null ? [] : [alpha])].map((value) =>
    value.toString(16).padStart(2, '0'),
  );
  const canCompress = pairs.every((pair) => pair[0] === pair[1]);
  return `#${pairs.map((pair) => (canCompress ? pair[0] : pair)).join('')}`;
}

/** `color-mix(in srgb, color (1 - amount), target)` */
export function mix(rgb: Rgb, target: number, amount: number): Rgb {
  const mixChannel = (value: number) =>
    channel(value + (target - value) * amount);
  return { r: mixChannel(rgb.r), g: mixChannel(rgb.g), b: mixChannel(rgb.b) };
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === red) {
    // Same as Rust's `rem_euclid(6.0)`, adding 6 to positive values changes the float result
    const remainder = ((green - blue) / delta) % 6;
    h = remainder < 0 ? remainder + 6 : remainder;
  } else if (max === green) {
    h = (blue - red) / delta + 2;
  } else {
    h = (red - green) / delta + 4;
  }
  return { h: h * 60, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  let rgb: [number, number, number];
  if (h < 60) rgb = [chroma, x, 0];
  else if (h < 120) rgb = [x, chroma, 0];
  else if (h < 180) rgb = [0, chroma, x];
  else if (h < 240) rgb = [0, x, chroma];
  else if (h < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const offset = l - chroma / 2;
  return {
    r: channel((rgb[0] + offset) * 255),
    g: channel((rgb[1] + offset) * 255),
    b: channel((rgb[2] + offset) * 255),
  };
}

/** Saturation is forced to 0% for near grays and 100% otherwise */
export function saturatedDarkerSaturation(saturation: number): number {
  return saturation < 0.2 ? 0 : 1;
}

/** Lightness goes toward 0% by `amount`, with the forced saturation */
export function saturatedDarker(rgb: Rgb, amount: number): Rgb {
  const { h, s, l } = rgbToHsl(rgb);
  return hslToRgb({ h, s: saturatedDarkerSaturation(s), l: l * (1 - amount) });
}

function apcaLuminance({ r, g, b }: Rgb): number {
  const linear = (value: number) => (value / 255) ** 2.4;
  const luminance =
    0.2126729 * linear(r) + 0.7151522 * linear(g) + 0.072175 * linear(b);
  return luminance < 0.022 ?
      luminance + (0.022 - luminance) ** 1.414
    : luminance;
}

/** APCA lightness contrast (Lc) of `text` over `background` */
function apcaContrast(text: Rgb, background: Rgb): number {
  const textY = apcaLuminance(text);
  const backgroundY = apcaLuminance(background);
  if (Math.abs(backgroundY - textY) < 0.0005) return 0;

  if (backgroundY > textY) {
    const contrast = (backgroundY ** 0.56 - textY ** 0.57) * 1.14;
    return contrast < 0.1 ? 0 : (contrast - 0.027) * 100;
  }
  const contrast = (backgroundY ** 0.65 - textY ** 0.62) * 1.14;
  return contrast > -0.1 ? 0 : (contrast + 0.027) * 100;
}

/** Whether black text has more APCA contrast than white text on `background` */
export function prefersBlackText(background: Rgb): boolean {
  return (
    Math.abs(apcaContrast({ r: 0, g: 0, b: 0 }, background))
    > Math.abs(apcaContrast({ r: 255, g: 255, b: 255 }, background))
  );
}

/** Rounded to drop float noise like `1 - 0.86 = 0.14000000000000001` */
export function formatFactor(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
}
