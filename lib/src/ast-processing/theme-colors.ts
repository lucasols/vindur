import { types as t } from '@babel/core';
import type { CssProcessingContext } from '../css-processing';
import {
  formatColorValue,
  getContrastColor,
  addAlphaToColor,
  darkenColor,
  lightenColor,
  minifyColor,
} from '../color-utils';
import { resolveImportedThemeColors } from './file-processing';

export function resolveThemeColorExpression(
  memberExpr: t.MemberExpression,
  context: CssProcessingContext,
  dev: boolean = false,
): string | null {
  // Handle theme color expressions like colors.primary.var, colors.primary.alpha(0.5), etc.
  
  // First, check if this is a simple property access like colors.primary.var
  if (
    t.isIdentifier(memberExpr.object) &&
    t.isIdentifier(memberExpr.property) &&
    !memberExpr.computed
  ) {
    const objectName = memberExpr.object.name;
    const propertyName = memberExpr.property.name;
    
    // Check if the object is a theme colors variable
    const themeColors = context.state.themeColors?.get(objectName);
    if (!themeColors) return null;
    
    // Handle colors.primary.var access
    if (propertyName === 'var') {
      const colorHex = themeColors[objectName]; // This should be colors.primary, not just primary
      if (colorHex) {
        return formatColorValue(colorHex, `${objectName}-var`, dev);
      }
    }
    
    return null;
  }
  
  // Handle nested member expressions like colors.primary.var or colors.primary.contrast.var
  if (
    t.isMemberExpression(memberExpr.object) &&
    t.isIdentifier(memberExpr.property) &&
    !memberExpr.computed
  ) {
    const nestedObject = memberExpr.object;
    const finalProperty = memberExpr.property.name;
    
    // Check if it's colors.primary.var pattern
    if (
      t.isIdentifier(nestedObject.object) &&
      t.isIdentifier(nestedObject.property) &&
      !nestedObject.computed
    ) {
      const themeName = nestedObject.object.name;
      const colorName = nestedObject.property.name;
      
      // Check local theme colors first
      let themeColors = context.state.themeColors?.get(themeName);
      
      // If not found locally, check imported theme colors
      if (!themeColors) {
        themeColors = resolveImportedThemeColors(themeName, context) || undefined;
      }
      
      if (!themeColors?.[colorName]) return null;
      
      const colorHex = themeColors[colorName];
      
      if (finalProperty === 'var') {
        const minifiedColor = minifyColor(colorHex);
        return formatColorValue(minifiedColor, `${colorName}-var`, dev);
      } else if (finalProperty === 'contrast') {
        // Handle colors.primary.contrast.var - this should be an object with var property
        return null; // Will be handled by the next level
      }
    }
    
    // Check if it's colors.primary.contrast.var pattern
    if (
      t.isMemberExpression(nestedObject.object) &&
      t.isIdentifier(nestedObject.object.object) &&
      t.isIdentifier(nestedObject.object.property) &&
      t.isIdentifier(nestedObject.property) &&
      !nestedObject.computed &&
      !nestedObject.object.computed
    ) {
      const themeName = nestedObject.object.object.name;
      const colorName = nestedObject.object.property.name;
      const contrastProp = nestedObject.property.name;
      
      // Check local theme colors first
      let themeColors = context.state.themeColors?.get(themeName);
      
      // If not found locally, check imported theme colors
      if (!themeColors) {
        themeColors = resolveImportedThemeColors(themeName, context) || undefined;
      }
      
      if (!themeColors?.[colorName] || contrastProp !== 'contrast') {
        return null;
      }
      
      const colorHex = themeColors[colorName];
      
      if (finalProperty === 'var') {
        const contrastColor = getContrastColor(colorHex);
        const minifiedColor = minifyColor(contrastColor);
        return formatColorValue(minifiedColor, `${colorName}-contrast-var`, dev);
      }
    }
  }
  
  return null;
}

export function resolveThemeColorCallExpression(
  callExpr: t.CallExpression,
  context: CssProcessingContext,
  dev: boolean = false,
): string | null {
  if (!t.isMemberExpression(callExpr.callee)) return null;
  
  // Handle colors.primary.alpha(0.5), colors.primary.darker(0.1), etc.
  const memberExpr = callExpr.callee;
  
  if (
    t.isMemberExpression(memberExpr.object) &&
    t.isIdentifier(memberExpr.object.object) &&
    t.isIdentifier(memberExpr.object.property) &&
    t.isIdentifier(memberExpr.property) &&
    !memberExpr.computed &&
    !memberExpr.object.computed
  ) {
    const themeName = memberExpr.object.object.name;
    const colorName = memberExpr.object.property.name;
    const methodName = memberExpr.property.name;
    
    // Check local theme colors first
    let themeColors = context.state.themeColors?.get(themeName);
    
    // If not found locally, check imported theme colors
    if (!themeColors) {
      themeColors = resolveImportedThemeColors(themeName, context) || undefined;
    }
    
    if (!themeColors?.[colorName]) return null;
    
    const colorHex = themeColors[colorName];
    const args = callExpr.arguments;
    
    if (methodName === 'alpha' && args.length === 1) {
      const alphaArg = args[0];
      if (t.isNumericLiteral(alphaArg)) {
        const alpha = alphaArg.value;
        const alphaColor = addAlphaToColor(colorHex, alpha);
        return formatColorValue(alphaColor, `${colorName}-alpha-${alpha}`, dev);
      }
    } else if (methodName === 'darker' && args.length === 1) {
      const amountArg = args[0];
      if (t.isNumericLiteral(amountArg)) {
        const amount = amountArg.value;
        const darkerColor = darkenColor(colorHex, amount);
        return formatColorValue(darkerColor, `${colorName}-darker-${amount}`, dev);
      }
    } else if (methodName === 'lighter' && args.length === 1) {
      const amountArg = args[0];
      if (t.isNumericLiteral(amountArg)) {
        const amount = amountArg.value;
        const lighterColor = lightenColor(colorHex, amount);
        return formatColorValue(lighterColor, `${colorName}-lighter-${amount}`, dev);
      }
    }
  }
  
  // Handle colors.primary.contrast.alpha(0.5), colors.primary.contrast.optimal(), etc.
  if (
    t.isMemberExpression(memberExpr.object) &&
    t.isMemberExpression(memberExpr.object.object) &&
    t.isIdentifier(memberExpr.object.object.object) &&
    t.isIdentifier(memberExpr.object.object.property) &&
    t.isIdentifier(memberExpr.object.property) &&
    t.isIdentifier(memberExpr.property) &&
    !memberExpr.computed &&
    !memberExpr.object.computed &&
    !memberExpr.object.object.computed
  ) {
    const themeName = memberExpr.object.object.object.name;
    const colorName = memberExpr.object.object.property.name;
    const contrastProp = memberExpr.object.property.name;
    const methodName = memberExpr.property.name;
    
    // Check local theme colors first
    let themeColors = context.state.themeColors?.get(themeName);
    
    // If not found locally, check imported theme colors
    if (!themeColors) {
      themeColors = resolveImportedThemeColors(themeName, context) || undefined;
    }
    
    if (!themeColors?.[colorName] || contrastProp !== 'contrast') {
      return null;
    }
    
    const colorHex = themeColors[colorName];
    const contrastColor = getContrastColor(colorHex);
    const args = callExpr.arguments;
    
    if (methodName === 'alpha' && args.length === 1) {
      const alphaArg = args[0];
      if (t.isNumericLiteral(alphaArg)) {
        const alpha = alphaArg.value;
        const alphaContrastColor = addAlphaToColor(contrastColor, alpha);
        return formatColorValue(alphaContrastColor, `${colorName}-contrast-alpha-${alpha}`, dev);
      }
    } else if (methodName === 'optimal' && args.length <= 1) {
      // Handle colors.primary.contrast.optimal({ saturation: 0.8 })
      if (args.length === 0) {
        return formatColorValue(contrastColor, `${colorName}-contrast-optimal`, dev);
      } else if (t.isObjectExpression(args[0])) {
        // For now, just return the basic contrast color
        // TODO: Implement saturation/alpha options
        return formatColorValue(contrastColor, `${colorName}-contrast-optimal`, dev);
      }
    }
  }
  
  return null;
}

