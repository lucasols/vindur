import * as babel from '@babel/core';
import { types as t } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import { extractLiteralValue } from '../ast-utils';
import { createVindurPlugin } from '../babel-plugin';
import type { CssProcessingContext } from '../css-processing';
import { TransformError } from '../custom-errors';

export function getOrExtractFileData(
  filePath: string,
  context: CssProcessingContext,
): {
  cssVariables: Map<string, import('../babel-plugin').CssVariableInfo>;
  keyframes: Map<string, string>;
  constants: Map<string, string | number>;
  objectConstants: Map<string, Record<string, string | number>>;
  themeColors: Map<string, Record<string, string>>;
} {
  // Check cache first
  const cached = context.extractedFiles.get(filePath);
  if (cached) return cached;

  // Load and extract data from file
  const fileContent = context.fs.readFile(filePath);

  // Track this file as a style dependency for HMR/rebuilds
  context.state.styleDependencies?.add(filePath);

  // Create a temporary state to capture both CSS variables and keyframes from external file
  const tempState = {
    cssRules: [],
    vindurImports: new Set<string>(),
    styledComponents: new Map(),
    cssVariables: new Map<string, import('../babel-plugin').CssVariableInfo>(),
    keyframes: new Map<string, string>(),
    themeColors: new Map<string, Record<string, string>>(),
    potentiallyUndeclaredScopedVariables: new Set<string>(),
  };

  // Create maps to collect constants during transform
  const allConstants = new Map<string, string | number>();
  const exportedConstants = new Map<string, string | number>();
  const allObjectConstants = new Map<string, Record<string, string | number>>();
  const exportedObjectConstants = new Map<
    string,
    Record<string, string | number>
  >();

  // Create a combined plugin that extracts both constants and CSS in one pass
  const constantsExtractorPlugin = createConstantsExtractorPlugin(
    allConstants,
    exportedConstants,
    allObjectConstants,
    exportedObjectConstants,
  );

  const vindurPlugin = createVindurPlugin(
    {
      filePath,
      sourceContent: fileContent, // Pass the source content for source map generation
      // Use same dev mode as the current transform to keep class naming consistent
      dev: context.dev,
      fs: context.fs,
      transformFunctionCache: context.compiledFunctions,
      dynamicColorCache: context.dynamicColorCache,
      importAliases: {}, // External files don't need alias resolution for their own processing
    },
    tempState,
  );

  // Transform the external file with both plugins in a single pass
  babel.transformSync(fileContent, {
    plugins: [constantsExtractorPlugin, vindurPlugin],
    parserOpts: { sourceType: 'module', plugins: ['typescript', 'jsx'] },
    filename: filePath,
  });

  // Debug: log extracted constants
  if (context.debug) {
    context.debug.log(
      `Extracted constants from ${filePath}: ${JSON.stringify(Array.from(exportedConstants.entries()))}`,
    );
    context.debug.log(
      `Extracted object constants from ${filePath}: ${JSON.stringify(Array.from(exportedObjectConstants.entries()))}`,
    );
  }

  // Create the result object
  const result = {
    cssVariables: new Map(tempState.cssVariables),
    keyframes: new Map(tempState.keyframes),
    constants: exportedConstants,
    objectConstants: exportedObjectConstants,
    themeColors: new Map(tempState.themeColors),
  };

  // Do NOT merge external CSS into the current file CSS output.
  // The external file will emit its own CSS. We only carry class names here.

  // Cache the result
  context.extractedFiles.set(filePath, result);

  return result;
}

function createConstantsExtractorPlugin(
  allConstants: Map<string, string | number>,
  exportedConstants: Map<string, string | number>,
  allObjectConstants: Map<string, Record<string, string | number>>,
  exportedObjectConstants: Map<string, Record<string, string | number>>,
): babel.PluginObj {
  return {
    name: 'extract-constants',
    visitor: {
      VariableDeclaration(path) {
        if (path.node.kind === 'const') {
          for (const declarator of path.node.declarations) {
            if (t.isIdentifier(declarator.id) && declarator.init) {
              const variableName = declarator.id.name;
              const value = extractLiteralValue(declarator.init);

              if (
                value !== null
                && (typeof value === 'string' || typeof value === 'number')
              ) {
                allConstants.set(variableName, value);
              } else if (t.isTemplateLiteral(declarator.init)) {
                // Try to resolve template literal with collected constants
                const resolvedValue = resolveTemplateLiteralWithConstants(
                  declarator.init,
                  allConstants,
                );
                if (resolvedValue !== null) {
                  allConstants.set(variableName, resolvedValue);
                }
              } else if (t.isObjectExpression(declarator.init)) {
                // Extract object literal with string/number properties and template literals
                const objectValue = extractObjectLiteral(declarator.init, allConstants);
                if (objectValue !== null) {
                  allObjectConstants.set(variableName, objectValue);
                }
              }
            }
          }
        }
      },
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
                if (
                  value !== null
                  && (typeof value === 'string' || typeof value === 'number')
                ) {
                  allConstants.set(variableName, value);
                  exportedConstants.set(variableName, value);
                } else if (t.isTemplateLiteral(declarator.init)) {
                  // Handle template literals in export declarations
                  const resolvedValue = resolveTemplateLiteralWithConstants(
                    declarator.init,
                    allConstants,
                  );
                  if (resolvedValue !== null) {
                    allConstants.set(variableName, resolvedValue);
                    exportedConstants.set(variableName, resolvedValue);
                  }
                } else if (t.isObjectExpression(declarator.init)) {
                  // Handle object literals in export declarations
                  const objectValue = extractObjectLiteral(declarator.init, allConstants);
                  if (objectValue !== null) {
                    allObjectConstants.set(variableName, objectValue);
                    exportedObjectConstants.set(variableName, objectValue);
                  }
                }
              } else {
                // Look for it in allConstants if it was declared separately
                const value = allConstants.get(variableName);
                if (value !== undefined) {
                  exportedConstants.set(variableName, value);
                }
                // Look for it in allObjectConstants if it was declared separately
                const objectValue = allObjectConstants.get(variableName);
                if (objectValue !== undefined) {
                  exportedObjectConstants.set(variableName, objectValue);
                }
              }
            }
          }
        }
      },
    },
  };
}

function resolveTemplateLiteralWithConstants(
  templateLiteral: t.TemplateLiteral,
  constants: Map<string, string | number>,
): string | null {
  // This function is used during file extraction phase where we want to be lenient
  // and only collect what we can resolve. Returning null is appropriate here.
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
          // Can't resolve this expression - return null to reject the entire object
          return null;
        }
      } else if (t.isBinaryExpression(expression)) {
        // Try to resolve binary expressions with constants
        const resolvedValue = resolveBinaryExpressionWithConstants(
          expression,
          constants,
        );
        if (resolvedValue !== null) {
          result += String(resolvedValue);
        } else {
          // Can't resolve this binary expression - return null to reject the entire object
          return null;
        }
      } else if (t.isNumericLiteral(expression)) {
        result += String(expression.value);
      } else if (t.isStringLiteral(expression)) {
        result += expression.value;
      } else {
        // Can't resolve other expression types - return null to reject the entire object
        return null;
      }
    }
  }

  return result;
}

function resolveBinaryExpressionWithConstants(
  expression: t.BinaryExpression,
  constants: Map<string, string | number>,
): number | null {
  // Check that both sides are expressions (not private names)
  if (!t.isExpression(expression.left) || !t.isExpression(expression.right)) {
    return null;
  }

  const left = resolveExpressionValue(expression.left, constants);
  const right = resolveExpressionValue(expression.right, constants);

  if (left === null || right === null) {
    return null;
  }

  // Only support arithmetic operations on numbers
  if (typeof left !== 'number' || typeof right !== 'number') {
    return null;
  }

  switch (expression.operator) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      return left / right;
    case '%':
      return left % right;
    default:
      // Don't support comparison or logical operators
      return null;
  }
}

function resolveExpressionValue(
  expression: t.Expression,
  constants: Map<string, string | number>,
): string | number | null {
  if (t.isIdentifier(expression)) {
    const value = constants.get(expression.name);
    return value !== undefined ? value : null;
  } else if (t.isNumericLiteral(expression)) {
    return expression.value;
  } else if (t.isStringLiteral(expression)) {
    return expression.value;
  } else {
    // Don't support other expression types for arithmetic
    return null;
  }
}

export function resolveImportedConstant(
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
    throw new TransformError(
      `Failed to load constant "${constantName}" from ${constantFilePath}`,
      notNullish(context.path.node.loc),
    );
  }
}

export function resolveImportedThemeColors(
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
    throw new TransformError(
      `Failed to load theme colors "${themeColorsName}" from ${themeColorsFilePath}`,
      notNullish(context.path.node.loc),
    );
  }
}

function extractObjectLiteral(
  objectExpression: t.ObjectExpression,
  constants?: Map<string, string | number>,
): Record<string, string | number> | null {
  const result: Record<string, string | number> = {};

  for (const property of objectExpression.properties) {
    if (
      t.isObjectProperty(property)
      && !property.computed
      && (t.isIdentifier(property.key) || t.isStringLiteral(property.key))
    ) {
      // Get the property key
      const key =
        t.isIdentifier(property.key) ? property.key.name : property.key.value;

      // Extract the literal value
      const value = extractLiteralValue(property.value);

      if (
        value !== null
        && (typeof value === 'string' || typeof value === 'number')
      ) {
        result[key] = value;
      } else if (t.isTemplateLiteral(property.value) && constants) {
        // Try to resolve template literal with constants
        const resolvedValue = resolveTemplateLiteralWithConstants(
          property.value,
          constants,
        );
        if (resolvedValue !== null) {
          result[key] = resolvedValue;
        } else {
          // If template literal can't be resolved, reject the entire object
          return null;
        }
      } else {
        // If any property is not a literal or resolvable template, reject the entire object
        return null;
      }
    } else {
      // If any property is computed or not simple, reject the entire object
      return null;
    }
  }

  return result;
}
