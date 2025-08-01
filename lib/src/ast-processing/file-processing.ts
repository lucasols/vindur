import * as babel from '@babel/core';
import { types as t } from '@babel/core';
import { extractLiteralValue } from '../ast-utils';
import { createVindurPlugin } from '../babel-plugin';
import type { CssProcessingContext } from '../css-processing';

export function getOrExtractFileData(
  filePath: string,
  context: CssProcessingContext,
): {
  cssVariables: Map<string, string>;
  keyframes: Map<string, string>;
  constants: Map<string, string | number>;
  themeColors: Map<string, Record<string, string>>;
} {
  // Check cache first
  const cached = context.extractedFiles.get(filePath);
  if (cached) return cached;

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
    potentiallyUndeclaredScopedVariables: new Set<string>(),
  };

  // Create maps to collect constants during transform
  const allConstants = new Map<string, string | number>();
  const exportedConstants = new Map<string, string | number>();

  // Create a combined plugin that extracts both constants and CSS in one pass
  const constantsExtractorPlugin = createConstantsExtractorPlugin(
    allConstants,
    exportedConstants,
  );

  const vindurPlugin = createVindurPlugin(
    {
      filePath,
      dev: false, // Use production mode for external files
      fs: context.fs,
      transformFunctionCache: context.compiledFunctions,
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
  }

  // Create the result object
  const result = {
    cssVariables: new Map(tempState.cssVariables),
    keyframes: new Map(tempState.keyframes),
    constants: exportedConstants,
    themeColors: new Map(tempState.themeColors),
  };

  // Add the CSS rules from the external file to the main CSS output
  context.state.cssRules.push(...tempState.cssRules);

  // Cache the result
  context.extractedFiles.set(filePath, result);

  return result;
}

function createConstantsExtractorPlugin(
  allConstants: Map<string, string | number>,
  exportedConstants: Map<string, string | number>,
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
                }
              } else {
                // Look for it in allConstants if it was declared separately
                const value = allConstants.get(variableName);
                if (value !== undefined) {
                  exportedConstants.set(variableName, value);
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
    throw new Error(
      `Failed to load constant "${constantName}" from ${constantFilePath}`,
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
    throw new Error(
      `Failed to load theme colors "${themeColorsName}" from ${themeColorsFilePath}`,
    );
  }
}
