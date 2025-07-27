/**
 * Color manipulation utilities for static theme colors
 */

import { colord, extend } from 'colord';
import a11yPlugin from 'colord/plugins/a11y';
import minifyPlugin from 'colord/plugins/minify';

// Extend colord with a11y and minify plugins
extend([a11yPlugin, minifyPlugin]);

export function formatColorValue(colorValue: string, varName: string, dev: boolean): string {
  // In dev mode, return CSS variable with fallback
  // In production mode, return the actual color value
  if (dev) {
    return `var(--stc-${varName.replace(/\./g, '\\.')}, ${colorValue})`;
  } else {
    return colorValue;
  }
}

export function getContrastColor(hex: string): string {
  // Use colord to calculate contrast color with better algorithm
  const color = colord(hex);
  
  // Get luminance and choose appropriate contrast
  const luminance = color.luminance();
  
  // For very light colors, use a dark gray instead of pure black
  // For dark colors, use white
  if (luminance > 0.6) {
    return colord('#1a1a1a').minify(); // Dark gray for very light backgrounds
  } else if (luminance > 0.5) {
    return colord('#000').minify(); // Black for light backgrounds
  } else {
    return colord('#fff').minify(); // White for dark backgrounds
  }
}

export function addAlphaToColor(hex: string, alpha: number): string {
  // Use colord to handle alpha with proper color parsing and minify output
  return colord(hex).alpha(alpha).minify({ alphaHex: true });
}

export function darkenColor(hex: string, amount: number): string {
  // Use colord's darken method for more accurate color manipulation with minified output
  return colord(hex).darken(amount).minify();
}

export function lightenColor(hex: string, amount: number): string {
  // Use colord's lighten method for more accurate color manipulation with minified output
  return colord(hex).lighten(amount).minify();
}

export function minifyColor(hex: string): string {
  // Minify any color using colord
  return colord(hex).minify();
}