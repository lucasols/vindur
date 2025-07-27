import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import generate from '@babel/generator';
import {
  extractArgumentValue,
  extractLiteralValue,
  isLiteralExpression,
} from '../ast-utils';
import type { CssProcessingContext } from '../css-processing';
import {
  resolveVariable,
  resolveBinaryExpression,
  resolveFunctionCall,
} from './resolution';
import { resolveThemeColorExpression } from './theme-colors';
import { resolveDynamicColorExpression, resolveDynamicColorCallExpression } from './dynamic-colors';
import { getOrExtractFileData } from './file-processing';

function isExtensionResult(
  result: string | { type: 'extension'; className: string },
): result is { type: 'extension'; className: string } {
  return typeof result === 'object' && 'type' in result;
}

export function processInterpolationExpression(
  expression: t.Expression,
  context: CssProcessingContext,
  variableName: string | undefined,
  tagType: string,
  interpolationContext: {
    isExtension?: boolean; // true if followed by semicolon
    dev?: boolean;
  } = {},
): string | { type: 'extension'; className: string } {
  if (t.isIdentifier(expression)) {
    // Check if this identifier refers to a styled component
    const styledComponent = context.state.styledComponents.get(expression.name);
    if (styledComponent) {
      // Return the className with a dot prefix for CSS selector usage
      return `.${styledComponent.className}`;
    }

    // Check if this identifier refers to a CSS variable
    const cssVariable = context.state.cssVariables.get(expression.name);
    if (cssVariable) {
      if (interpolationContext.isExtension) {
        // For extension syntax (${baseStyles};), return extension object
        return { type: 'extension', className: cssVariable };
      } else {
        // For CSS variables, always return with dot prefix for selector usage
        return `.${cssVariable}`;
      }
    }

    // Check if this identifier refers to a keyframes animation
    const keyframesAnimation = context.state.keyframes.get(expression.name);
    if (keyframesAnimation) {
      // For keyframes, return the animation name without prefix
      return keyframesAnimation;
    }

    // Check if this identifier refers to an imported keyframes
    const importedKeyframes = resolveImportedKeyframes(expression.name, context);
    if (importedKeyframes !== null) {
      return importedKeyframes;
    }

    // Check if this identifier refers to an imported CSS variable
    const importedCss = resolveImportedCss(expression.name, context);
    if (importedCss !== null) {
      if (interpolationContext.isExtension) {
        // For extension syntax (${baseStyles};), return extension object
        return { type: 'extension', className: importedCss };
      } else {
        // For CSS variables, always return with dot prefix for selector usage
        return `.${importedCss}`;
      }
    }

    // Check if this identifier refers to an imported constant (string or number)
    const importedConstant = resolveImportedConstantLocal(expression.name, context);
    if (importedConstant !== null) {
      return String(importedConstant);
    }

    // If we have an imported function but it wasn't found in any resolver, throw an error
    const importedFilePath = context.importedFunctions.get(expression.name);
    if (importedFilePath) {
      throw new Error(`Function "${expression.name}" not found in ${importedFilePath}`);
    }

    const resolvedValue = resolveVariable(expression.name, context.path);
    if (resolvedValue !== null) {
      return resolvedValue;
    } else {
      const varContext =
        variableName ? `... ${variableName} = ${tagType}` : tagType;
      throw new Error(
        `Invalid interpolation used at \`${varContext}\` ... \${${expression.name}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported`,
      );
    }
  } else if (t.isArrowFunctionExpression(expression)) {
    // Handle forward references: ${() => Component}
    if (
      expression.params.length === 0 &&
      t.isIdentifier(expression.body) &&
      !expression.async
    ) {
      const componentName = expression.body.name;
      // For forward references, we'll defer the resolution by storing a placeholder
      // The actual resolution will happen during post-processing when all components are defined
      return `__FORWARD_REF__${componentName}__`;
    } else {
      const varContext =
        variableName ? `... ${variableName} = ${tagType}` : tagType;
      throw new Error(
        `Invalid arrow function in interpolation at \`${varContext}\`. Only simple forward references like \${() => Component} are supported`,
      );
    }
  } else if (isLiteralExpression(expression)) {
    const value = extractLiteralValue(expression);
    return String(value);
  } else if (t.isTemplateLiteral(expression)) {
    const nested = processTemplateWithInterpolation(
      expression,
      context,
      variableName,
      tagType,
      interpolationContext.dev || false,
    );
    return nested.cssContent;
  } else if (t.isCallExpression(expression)) {
    // Try regular function calls first
    const functionResolved = resolveFunctionCall(
      expression,
      context,
      interpolationContext.dev || false,
    );
    if (functionResolved !== null) {
      return functionResolved;
    }
    
    // Try dynamic color function calls
    const dynamicResolved = resolveDynamicColorCallExpression(expression, context);
    if (dynamicResolved !== null) {
      return dynamicResolved;
    }
    
    const expressionSource = generate(expression).code;
    const varContext =
      variableName ? `... ${variableName} = ${tagType}` : tagType;
    throw new Error(
      `Unresolved function call at \`${varContext}\` ... \${${expressionSource}}, function must be statically analyzable and correctly imported with the configured aliases`,
    );
  } else if (t.isBinaryExpression(expression)) {
    const resolved = resolveBinaryExpression(expression, context.path, context);
    if (resolved !== null) {
      return resolved;
    } else {
      const expressionSource = generate(expression).code;
      const varContext =
        variableName ? `... ${variableName} = ${tagType}` : tagType;
      throw new Error(
        `Unresolved binary expression at \`${varContext}\` ... \${${expressionSource}}, only simple arithmetic with constants is supported`,
      );
    }
  } else if (t.isMemberExpression(expression)) {
    // Try theme colors first
    const themeResolved = resolveThemeColorExpression(expression, context, interpolationContext.dev || false);
    if (themeResolved !== null) {
      return themeResolved;
    }
    
    // Try dynamic colors
    const dynamicResolved = resolveDynamicColorExpression(expression, context);
    if (dynamicResolved !== null) {
      return dynamicResolved;
    }
    
    const expressionSource = generate(expression).code;
    const varContext =
      variableName ? `... ${variableName} = ${tagType}` : tagType;
    throw new Error(
      `Invalid interpolation used at \`${varContext}\` ... \${${expressionSource}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
    );
  } else {
    const expressionSource = generate(expression).code;
    const varContext =
      variableName ? `... ${variableName} = ${tagType}` : tagType;
    const errorMessage = `Invalid interpolation used at \`${varContext}\` ... \${${expressionSource}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`;
    throw new Error(errorMessage);
  }
}

export function processTemplateWithInterpolation(
  quasi: t.TemplateLiteral,
  context: CssProcessingContext,
  variableName: string | undefined,
  tagType: string,
  dev: boolean = false,
) {
  let cssContent = '';
  const extensions: string[] = [];

  // Process template literal with interpolations
  for (let i = 0; i < quasi.quasis.length; i++) {
    // Add the static string part - use cooked value to preserve formatting
    const staticPart = quasi.quasis[i]?.value.cooked ?? '';
    cssContent += staticPart;

    // Add the interpolated expression if it exists
    if (i < quasi.expressions.length) {
      const expression = quasi.expressions[i];
      if (expression && t.isExpression(expression)) {
        // Check context around interpolation
        const nextPart = quasi.quasis[i + 1]?.value.cooked ?? '';
        const isExtension = nextPart.trimStart().startsWith(';');

        const resolvedExpression = processInterpolationExpression(
          expression,
          context,
          variableName,
          tagType.includes('styled') ? 'styled' : 'css',
          { isExtension, dev },
        );

        if (typeof resolvedExpression === 'string') {
          cssContent += resolvedExpression;
        } else if (isExtensionResult(resolvedExpression)) {
          // Handle extension - store for later class combination
          extensions.push(resolvedExpression.className);
        }
      }
    }
  }

  return { cssContent, extensions };
}

// These are moved from the resolution module to avoid circular imports
function resolveImportedKeyframes(
  keyframesName: string,
  context: CssProcessingContext,
): string | null {
  // Check if this keyframes is imported from another file
  const keyframesFilePath = context.importedFunctions.get(keyframesName);
  
  if (!keyframesFilePath) return null;

  // Load and process the external file to extract keyframes
  try {
    const extractedData = getOrExtractFileData(keyframesFilePath, context);
    
    // Look for the specific keyframes in the external file
    const keyframesAnimationName = extractedData.keyframes.get(keyframesName);
    if (keyframesAnimationName) {
      // Mark this keyframes as used (for import cleanup)
      context.usedFunctions.add(keyframesName);
      return keyframesAnimationName;
    }
    
    // Return null if not found (allow other resolvers to try)
    return null;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to load keyframes "${keyframesName}" from ${keyframesFilePath}`);
  }
}

function resolveImportedCss(
  cssName: string,
  context: CssProcessingContext,
): string | null {
  // Check if this CSS is imported from another file
  const cssFilePath = context.importedFunctions.get(cssName);
  
  if (!cssFilePath) return null;

  // Load and process the external file to extract CSS variables
  try {
    const extractedData = getOrExtractFileData(cssFilePath, context);
    
    // Look for the specific CSS variable in the external file
    const cssClassName = extractedData.cssVariables.get(cssName);
    if (cssClassName) {
      // Mark this CSS as used (for import cleanup)
      context.usedFunctions.add(cssName);
      return cssClassName;
    }
    
    // Return null if not found (allow other resolvers to try)
    return null;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to load CSS "${cssName}" from ${cssFilePath}`);
  }
}

function resolveImportedConstantLocal(
  constantName: string,
  context: CssProcessingContext,
): string | number | null {
  // Check if this constant is imported from another file
  const constantFilePath = context.importedFunctions.get(constantName);
  
  if (!constantFilePath) return null;

  // Load and process the external file to extract constants
  try {
    const extractedData = getOrExtractFileData(constantFilePath, context);
    
    // Look for the specific constant in the external file
    const constantValue = extractedData.constants.get(constantName);
    if (constantValue !== undefined) {
      // Mark this constant as used (for import cleanup)
      context.usedFunctions.add(constantName);
      return constantValue;
    }
    
    // Return null if not found (allow other resolvers to try)
    return null;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to load constant "${constantName}" from ${constantFilePath}`);
  }
}

