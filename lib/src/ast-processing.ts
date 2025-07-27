import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import generate from '@babel/generator';
import {
  extractArgumentValue,
  extractLiteralValue,
  isLiteralExpression,
} from './ast-utils';
import { evaluateOutput } from './evaluation';
import type { FunctionArg } from './types';
import * as babel from '@babel/core';
import { createVindurPlugin } from './babel-plugin';
import type { CssProcessingContext } from './css-processing';
import {
  formatColorValue,
  getContrastColor,
  addAlphaToColor,
  darkenColor,
  lightenColor,
  minifyColor,
} from './color-utils';

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
    const importedConstant = resolveImportedConstant(expression.name, context);
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
    const resolved = resolveFunctionCall(
      expression,
      context,
      interpolationContext.dev || false,
    );
    if (resolved !== null) {
      return resolved;
    } else {
      const expressionSource = generate(expression).code;
      const varContext =
        variableName ? `... ${variableName} = ${tagType}` : tagType;
      throw new Error(
        `Unresolved function call at \`${varContext}\` ... \${${expressionSource}}, function must be statically analyzable and correctly imported with the configured aliases`,
      );
    }
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
    const resolved = resolveThemeColorExpression(expression, context, interpolationContext.dev || false);
    if (resolved !== null) {
      return resolved;
    } else {
      const expressionSource = generate(expression).code;
      const varContext =
        variableName ? `... ${variableName} = ${tagType}` : tagType;
      throw new Error(
        `Invalid interpolation used at \`${varContext}\` ... \${${expressionSource}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
      );
    }
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

export function resolveVariable(variableName: string, path: NodePath): string | null {
  // Find the variable declaration in the current scope or parent scopes
  const binding = path.scope.getBinding(variableName);

  if (!binding?.path) {
    return null;
  }

  const declarationPath = binding.path;

  // Handle variable declarations
  if (declarationPath.isVariableDeclarator() && declarationPath.node.init) {
    const init = declarationPath.node.init;

    const literalValue = extractLiteralValue(init);
    if (literalValue !== null) {
      return String(literalValue);
    } else if (t.isBinaryExpression(init)) {
      // Try to resolve simple binary expressions like `margin * 2`
      const resolved = resolveBinaryExpression(init, path);
      return resolved;
    }
  }

  return null;
}

export function resolveBinaryExpression(
  expr: t.BinaryExpression,
  path: NodePath,
  context?: CssProcessingContext,
): string | null {
  const { left, right, operator } = expr;

  let leftValue: number | null = null;
  let rightValue: number | null = null;

  // Resolve left operand
  const leftLiteral = extractLiteralValue(left);
  if (typeof leftLiteral === 'number') {
    leftValue = leftLiteral;
  } else if (t.isIdentifier(left)) {
    // Try to resolve as imported constant first if context is available
    if (context) {
      const importedConstant = resolveImportedConstant(left.name, context);
      if (importedConstant !== null && typeof importedConstant === 'number') {
        leftValue = importedConstant;
      }
    }
    
    // Fall back to local variable resolution
    if (leftValue === null) {
      const resolved = resolveVariable(left.name, path);
      if (resolved !== null && !isNaN(Number(resolved))) {
        leftValue = Number(resolved);
      }
    }
  }

  // Resolve right operand
  const rightLiteral = extractLiteralValue(right);
  if (typeof rightLiteral === 'number') {
    rightValue = rightLiteral;
  } else if (t.isIdentifier(right)) {
    // Try to resolve as imported constant first if context is available
    if (context) {
      const importedConstant = resolveImportedConstant(right.name, context);
      if (importedConstant !== null && typeof importedConstant === 'number') {
        rightValue = importedConstant;
      }
    }
    
    // Fall back to local variable resolution
    if (rightValue === null) {
      const resolved = resolveVariable(right.name, path);
      if (resolved !== null && !isNaN(Number(resolved))) {
        rightValue = Number(resolved);
      }
    }
  }

  // Perform the operation if both operands are resolved
  if (leftValue !== null && rightValue !== null) {
    switch (operator) {
      case '+':
        return (leftValue + rightValue).toString();
      case '-':
        return (leftValue - rightValue).toString();
      case '*':
        return (leftValue * rightValue).toString();
      case '/':
        return (leftValue / rightValue).toString();
      default:
        return null;
    }
  }

  return null;
}

export function resolveFunctionCall(
  callExpr: t.CallExpression,
  context: CssProcessingContext,
  dev: boolean = false,
): string | null {
  // First try to resolve theme color call expressions
  const themeColorResult = resolveThemeColorCallExpression(callExpr, context, dev);
  if (themeColorResult !== null) {
    return themeColorResult;
  }
  
  if (!t.isIdentifier(callExpr.callee)) return null;

  const functionName = callExpr.callee.name;
  const functionFilePath = context.importedFunctions.get(functionName);

  if (!functionFilePath) return null;

  // Load the function (validation happens here, throws on error)
  const compiledFn = context.loadExternalFunction(
    context.fs,
    functionFilePath,
    functionName,
    context.compiledFunctions,
    context.debug,
  );
  const args = callExpr.arguments;

  // Mark this function as used
  context.usedFunctions.add(functionName);

  // TypeScript will handle argument count validation, so we don't need runtime checks

  if (compiledFn.type === 'positional') {
    // Handle positional arguments - need to map to parameter names
    const argValues: Record<string, string | number | boolean | undefined> = {};

    // Get parameter names from the compiled function
    const paramNames = getParameterNames(compiledFn);

    // Initialize all parameters to undefined first
    for (const [index] of compiledFn.args.entries()) {
      const paramName = paramNames[index];
      if (paramName) {
        argValues[paramName] = undefined;
      }
    }

    // Then set the provided arguments
    for (const [index, arg] of args.entries()) {
      const paramName = paramNames[index];
      if (paramName && t.isExpression(arg)) {
        const { value, resolved } = extractArgumentValue(arg, context.path);
        if (resolved && value !== null) {
          argValues[paramName] = value;
        }
      }
    }

    return evaluateOutput(compiledFn.output, argValues);
  } else {
    // Handle destructured object arguments
    if (args.length === 1 && t.isObjectExpression(args[0])) {
      const argValues: Record<string, string | number | boolean | undefined> =
        {};

      // Add default values first
      for (const [name, argDef] of Object.entries(compiledFn.args)) {
        if (argDef.defaultValue !== undefined) {
          argValues[name] = argDef.defaultValue;
        }
      }

      // Override with provided values
      for (const prop of args[0].properties) {
        if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
          const key = prop.key.name;
          const value = extractLiteralValue(prop.value);
          if (value !== null) {
            argValues[key] = value;
          }
        }
      }

      return evaluateOutput(compiledFn.output, argValues);
    }
  }

  return null;
}

function getParameterNames(compiledFn: {
  type: 'positional';
  args: FunctionArg[];
}): string[] {
  return compiledFn.args.map((arg) => arg.name ?? 'unknown');
}

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

function resolveImportedConstant(
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

function resolveImportedThemeColors(
  themeColorsName: string,
  context: CssProcessingContext,
): Record<string, string> | null {
  // Check if this theme colors object is imported from another file
  const themeColorsFilePath = context.importedFunctions.get(themeColorsName);
  
  if (!themeColorsFilePath) return null;

  // Load and process the external file to extract theme colors
  try {
    const extractedData = getOrExtractFileData(themeColorsFilePath, context);
    
    // Look for the specific theme colors in the external file
    const themeColorsValue = extractedData.themeColors.get(themeColorsName);
    if (themeColorsValue) {
      // Mark this theme colors as used (for import cleanup)
      context.usedFunctions.add(themeColorsName);
      return themeColorsValue;
    }
    
    // Return null if not found (allow other resolvers to try)
    return null;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to load theme colors "${themeColorsName}" from ${themeColorsFilePath}`);
  }
}


function getOrExtractFileData(
  filePath: string,
  context: CssProcessingContext,
): { cssVariables: Map<string, string>; keyframes: Map<string, string>; constants: Map<string, string | number>; themeColors: Map<string, Record<string, string>> } {
  // Check cache first
  const cached = context.extractedFiles.get(filePath);
  if (cached) {
    return cached;
  }

  // Load and extract data from file
  const fileContent = context.fs.readFile(filePath);
  
  // Create a temporary state to capture both CSS variables and keyframes from external file
  const tempState = {
    cssRules: [],
    vindurImports: new Set<string>(),
    styledComponents: new Map(),
    cssVariables: new Map<string, string>(),
    keyframes: new Map<string, string>(),
    themeColors: new Map<string, Record<string, string>>(),
  };
  
  // Parse the file to get the AST
  const parseResult = babel.parseSync(fileContent, {
    sourceType: 'module',
    parserOpts: {
      plugins: ['typescript', 'jsx'],
    },
    filename: filePath,
  });

  if (!parseResult) {
    throw new Error(`Failed to parse AST for ${filePath}`);
  }

  // Extract constants from the parsed AST (without transformation)
  const constants = extractConstantsFromAST(parseResult, fileContent);

  // Now transform the file to extract CSS variables and keyframes
  const plugin = createVindurPlugin(
    {
      filePath,
      dev: false, // Use production mode for external files
      fs: context.fs,
      transformFunctionCache: context.compiledFunctions,
      importAliases: {}, // External files don't need alias resolution for their own processing
    },
    tempState,
  );
  
  // Transform the external file to extract CSS and keyframes
  babel.transformSync(fileContent, {
    plugins: [plugin],
    parserOpts: { sourceType: 'module', plugins: ['typescript', 'jsx'] },
    filename: filePath,
  });
  
  // Debug: log extracted constants
  if (context.debug) {
    context.debug.log(`Extracted constants from ${filePath}: ${JSON.stringify(Array.from(constants.entries()))}`);
  }
  
  // Create the result object
  const result = {
    cssVariables: new Map(tempState.cssVariables),
    keyframes: new Map(tempState.keyframes),
    constants,
    themeColors: new Map(tempState.themeColors),
  };
  
  // Cache the result
  context.extractedFiles.set(filePath, result);
  
  // Add the CSS rules from the external file to the main CSS output
  context.state.cssRules.push(...tempState.cssRules);
  
  return result;
}

function extractConstantsFromAST(
  ast: t.File,
  _sourceCode: string,
): Map<string, string | number> {
  const constants = new Map<string, string | number>();
  const allConstants = new Map<string, string | number>();

  // First pass: collect all const declarations
  babel.traverse(ast, {
    VariableDeclaration(path) {
      if (path.node.kind === 'const') {
        for (const declarator of path.node.declarations) {
          if (t.isIdentifier(declarator.id) && declarator.init) {
            const variableName = declarator.id.name;
            const value = extractLiteralValue(declarator.init);
            
            if (value !== null && (typeof value === 'string' || typeof value === 'number')) {
              allConstants.set(variableName, value);
            }
          }
        }
      }
    },
  });

  // Second pass: resolve template literals now that all literals are collected
  babel.traverse(ast, {
    VariableDeclaration(path) {
      if (path.node.kind === 'const') {
        for (const declarator of path.node.declarations) {
          if (t.isIdentifier(declarator.id) && declarator.init && t.isTemplateLiteral(declarator.init)) {
            const variableName = declarator.id.name;
            // Try to resolve template literal with the constants we've collected
            const resolvedValue = resolveTemplateLiteralWithConstants(declarator.init, allConstants);
            if (resolvedValue !== null) {
              allConstants.set(variableName, resolvedValue);
            }
          }
        }
      }
    },
  });

  // Third pass: find exported constants
  babel.traverse(ast, {
    ExportNamedDeclaration(path) {
      const declaration = path.node.declaration;
      
      if (t.isVariableDeclaration(declaration)) {
        // Handle: export const name = value
        for (const declarator of declaration.declarations) {
          if (t.isIdentifier(declarator.id)) {
            const variableName = declarator.id.name;
            
            // Try to get the value directly from the declarator
            if (declarator.init) {
              const value = extractLiteralValue(declarator.init);
              if (value !== null && (typeof value === 'string' || typeof value === 'number')) {
                constants.set(variableName, value);
              } else if (t.isTemplateLiteral(declarator.init)) {
                // Handle template literals in export declarations
                const resolvedValue = resolveTemplateLiteralWithConstants(declarator.init, allConstants);
                if (resolvedValue !== null) {
                  constants.set(variableName, resolvedValue);
                }
              }
            } else {
              // Look for it in allConstants if it was declared separately
              const value = allConstants.get(variableName);
              if (value !== undefined) {
                constants.set(variableName, value);
              }
            }
          }
        }
      }
    },
  });

  return constants;
}

function resolveTemplateLiteralWithConstants(
  templateLiteral: t.TemplateLiteral,
  constants: Map<string, string | number>,
): string | null {
  // Try to resolve the template literal
  let result = '';
  
  for (let i = 0; i < templateLiteral.quasis.length; i++) {
    const quasi = templateLiteral.quasis[i];
    if (!quasi) continue;
    result += quasi.value.cooked || quasi.value.raw;
    
    if (i < templateLiteral.expressions.length) {
      const expression = templateLiteral.expressions[i];
      
      if (t.isIdentifier(expression)) {
        const constantValue = constants.get(expression.name);
        if (constantValue !== undefined) {
          result += String(constantValue);
        } else {
          // Can't resolve this expression
          return null;
        }
      } else {
        // Can't resolve non-identifier expressions
        return null;
      }
    }
  }
  
  return result;
}

function resolveThemeColorExpression(
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
    if (!themeColors) {
      return null;
    }
    
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
      
      if (!themeColors || !themeColors[colorName]) {
        return null;
      }
      
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
      
      if (!themeColors || !themeColors[colorName] || contrastProp !== 'contrast') {
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

function resolveThemeColorCallExpression(
  callExpr: t.CallExpression,
  context: CssProcessingContext,
  dev: boolean = false,
): string | null {
  if (!t.isMemberExpression(callExpr.callee)) {
    return null;
  }
  
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
    
    if (!themeColors || !themeColors[colorName]) {
      return null;
    }
    
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
    
    if (!themeColors || !themeColors[colorName] || contrastProp !== 'contrast') {
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

