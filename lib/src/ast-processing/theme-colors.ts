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

function resolveSimpleThemePropertyAccess(
  memberExpr: t.MemberExpression,
  context: CssProcessingContext,
  dev: boolean,
): string | null {
  if (
    !t.isIdentifier(memberExpr.object)
    || !t.isIdentifier(memberExpr.property)
    || memberExpr.computed
  ) {
    return null;
  }

  const objectName = memberExpr.object.name;
  const propertyName = memberExpr.property.name;

  const themeColors = context.state.themeColors?.get(objectName);
  if (!themeColors) return null;

  if (propertyName === 'var') {
    const colorHex = themeColors[objectName];
    if (colorHex) {
      return formatColorValue(colorHex, `${objectName}-var`, dev);
    }
  }

  return null;
}

function getThemeColors(
  themeName: string,
  context: CssProcessingContext,
): Record<string, string> | undefined {
  let themeColors = context.state.themeColors?.get(themeName);

  if (!themeColors) {
    themeColors = resolveImportedThemeColors(themeName, context) || undefined;
  }

  return themeColors;
}

function resolveNestedThemePropertyAccess(
  memberExpr: t.MemberExpression,
  context: CssProcessingContext,
  dev: boolean,
): string | null {
  if (
    !t.isMemberExpression(memberExpr.object)
    || !t.isIdentifier(memberExpr.property)
    || memberExpr.computed
  ) {
    return null;
  }

  const nestedObject = memberExpr.object;
  const finalProperty = memberExpr.property.name;

  // Handle colors.primary.var pattern
  if (
    t.isIdentifier(nestedObject.object)
    && t.isIdentifier(nestedObject.property)
    && !nestedObject.computed
  ) {
    const themeName = nestedObject.object.name;
    const colorName = nestedObject.property.name;

    const themeColors = getThemeColors(themeName, context);
    if (!themeColors?.[colorName]) return null;

    const colorHex = themeColors[colorName];

    if (finalProperty === 'var') {
      const minifiedColor = minifyColor(colorHex);
      return formatColorValue(minifiedColor, `${colorName}-var`, dev);
    } else if (finalProperty === 'contrast') {
      return null; // Will be handled by deep nested resolver
    }
  }

  return resolveDeepNestedThemePropertyAccess(memberExpr, context, dev);
}

function resolveDeepNestedThemePropertyAccess(
  memberExpr: t.MemberExpression,
  context: CssProcessingContext,
  dev: boolean,
): string | null {
  if (
    !t.isMemberExpression(memberExpr.object)
    || !t.isIdentifier(memberExpr.property)
  ) {
    return null;
  }

  const nestedObject = memberExpr.object;
  const finalProperty = memberExpr.property.name;

  if (
    !t.isMemberExpression(nestedObject.object)
    || !t.isIdentifier(nestedObject.object.object)
    || !t.isIdentifier(nestedObject.object.property)
    || !t.isIdentifier(nestedObject.property)
    || nestedObject.computed
    || nestedObject.object.computed
  ) {
    return null;
  }

  const themeName = nestedObject.object.object.name;
  const colorName = nestedObject.object.property.name;
  const contrastProp = nestedObject.property.name;

  const themeColors = getThemeColors(themeName, context);
  if (!themeColors?.[colorName] || contrastProp !== 'contrast') {
    return null;
  }

  const colorHex = themeColors[colorName];

  if (finalProperty === 'var') {
    const contrastColor = getContrastColor(colorHex);
    const minifiedColor = minifyColor(contrastColor);
    return formatColorValue(minifiedColor, `${colorName}-contrast-var`, dev);
  }

  return null;
}

export function resolveThemeColorExpression(
  memberExpr: t.MemberExpression,
  context: CssProcessingContext,
  dev: boolean = false,
): string | null {
  // Try simple property access first
  const simpleResult = resolveSimpleThemePropertyAccess(
    memberExpr,
    context,
    dev,
  );
  if (simpleResult !== null) return simpleResult;

  // Try nested property access
  return resolveNestedThemePropertyAccess(memberExpr, context, dev);
}

function resolveSimpleColorMethod(
  memberExpr: t.MemberExpression,
  args: (t.Expression | t.SpreadElement | t.ArgumentPlaceholder)[],
  context: CssProcessingContext,
  dev: boolean,
): string | null {
  if (
    !t.isMemberExpression(memberExpr.object)
    || !t.isIdentifier(memberExpr.object.object)
    || !t.isIdentifier(memberExpr.object.property)
    || !t.isIdentifier(memberExpr.property)
    || memberExpr.computed
    || memberExpr.object.computed
  ) {
    return null;
  }

  const themeName = memberExpr.object.object.name;
  const colorName = memberExpr.object.property.name;
  const methodName = memberExpr.property.name;

  const themeColors = getThemeColors(themeName, context);
  if (!themeColors?.[colorName]) return null;

  const colorHex = themeColors[colorName];

  return applyColorMethod(colorHex, methodName, args, colorName, dev);
}

function applyColorMethod(
  colorHex: string,
  methodName: string,
  args: (t.Expression | t.SpreadElement | t.ArgumentPlaceholder)[],
  colorName: string,
  dev: boolean,
): string | null {
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
      return formatColorValue(
        darkerColor,
        `${colorName}-darker-${amount}`,
        dev,
      );
    }
  } else if (methodName === 'lighter' && args.length === 1) {
    const amountArg = args[0];
    if (t.isNumericLiteral(amountArg)) {
      const amount = amountArg.value;
      const lighterColor = lightenColor(colorHex, amount);
      return formatColorValue(
        lighterColor,
        `${colorName}-lighter-${amount}`,
        dev,
      );
    }
  }

  return null;
}

function resolveContrastColorMethod(
  memberExpr: t.MemberExpression,
  args: (t.Expression | t.SpreadElement | t.ArgumentPlaceholder)[],
  context: CssProcessingContext,
  dev: boolean,
): string | null {
  if (
    !t.isMemberExpression(memberExpr.object)
    || !t.isMemberExpression(memberExpr.object.object)
    || !t.isIdentifier(memberExpr.object.object.object)
    || !t.isIdentifier(memberExpr.object.object.property)
    || !t.isIdentifier(memberExpr.object.property)
    || !t.isIdentifier(memberExpr.property)
    || memberExpr.computed
    || memberExpr.object.computed
    || memberExpr.object.object.computed
  ) {
    return null;
  }

  const themeName = memberExpr.object.object.object.name;
  const colorName = memberExpr.object.object.property.name;
  const contrastProp = memberExpr.object.property.name;
  const methodName = memberExpr.property.name;

  const themeColors = getThemeColors(themeName, context);
  if (!themeColors || contrastProp !== 'contrast') {
    return null;
  }

  const colorHex = themeColors[colorName];
  if (!colorHex) return null;
  const contrastColor = getContrastColor(colorHex);

  if (methodName === 'alpha' && args.length === 1) {
    const alphaArg = args[0];
    if (t.isNumericLiteral(alphaArg)) {
      const alpha = alphaArg.value;
      const alphaContrastColor = addAlphaToColor(contrastColor, alpha);
      return formatColorValue(
        alphaContrastColor,
        `${colorName}-contrast-alpha-${alpha}`,
        dev,
      );
    }
  } else if (methodName === 'optimal' && args.length <= 1) {
    if (args.length === 0) {
      return formatColorValue(
        contrastColor,
        `${colorName}-contrast-optimal`,
        dev,
      );
    } else if (t.isObjectExpression(args[0])) {
      // For now, just return the basic contrast color
      // TODO: Implement saturation/alpha options
      return formatColorValue(
        contrastColor,
        `${colorName}-contrast-optimal`,
        dev,
      );
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

  const memberExpr = callExpr.callee;
  const args = callExpr.arguments;

  // Try simple color method first (colors.primary.alpha(0.5))
  const simpleResult = resolveSimpleColorMethod(memberExpr, args, context, dev);
  if (simpleResult !== null) return simpleResult;

  // Try contrast color method (colors.primary.contrast.alpha(0.5))
  return resolveContrastColorMethod(memberExpr, args, context, dev);
}
