import type { NodePath, PluginObj } from '@babel/core';
import * as babel from '@babel/core';
import { types as t } from '@babel/core';
import generate from '@babel/generator';
import { murmur2 } from '@ls-stack/utils/hash';
import {
  extractArgumentValue,
  extractLiteralValue,
  isLiteralExpression,
} from './ast-utils';
import { evaluateOutput } from './evaluation';
import { parseFunction } from './function-parser';
import type { TransformFS } from './transform';
import type { CompiledFunction, FunctionArg } from './types';

export type VindurPluginOptions = {
  dev?: boolean;
  filePath: string;
  fs: { readFile: (path: string) => string };
};

export type VindurPluginState = {
  cssRules: string[];
  vindurImports: Set<string>;
  compiledFunctions: {
    [filePath: string]: { [functionName: string]: CompiledFunction };
  };
};

function processInterpolationExpression(
  expression: t.Expression,
  path: NodePath,
  fs: TransformFS,
  compiledFunctions: VindurPluginState['compiledFunctions'],
  importedFunctions: Map<string, string>,
  variableName: string | undefined,
  usedFunctions: Set<string>,
): string {
  if (t.isIdentifier(expression)) {
    const resolvedValue = resolveVariable(expression.name, path);
    if (resolvedValue !== null) {
      return resolvedValue;
    } else {
      const varContext = variableName ? `... ${variableName} = css` : 'css';
      throw new Error(
        `Invalid interpolation used at \`${varContext}\` ... \${${expression.name}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
      );
    }
  } else if (isLiteralExpression(expression)) {
    const value = extractLiteralValue(expression);
    return String(value);
  } else if (t.isTemplateLiteral(expression)) {
    const nested = processTemplateWithInterpolation(
      expression,
      path,
      fs,
      compiledFunctions,
      importedFunctions,
      variableName,
      usedFunctions,
    );
    return nested.cssContent;
  } else if (t.isCallExpression(expression)) {
    const resolved = resolveFunctionCall(
      expression,
      compiledFunctions,
      importedFunctions,
      fs,
      usedFunctions,
    );
    if (resolved !== null) {
      return resolved;
    } else {
      const expressionSource = generate(expression).code;
      const varContext = variableName ? `... ${variableName} = css` : 'css';
      throw new Error(
        `Unresolved function call at \`${varContext}\` ... \${${expressionSource}}, function must be statically analyzable`,
      );
    }
  } else {
    const expressionSource = generate(expression).code;
    const varContext = variableName ? `... ${variableName} = css` : 'css';
    const errorMessage = `Invalid interpolation used at \`${varContext}\` ... \${${expressionSource}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`;
    throw new Error(errorMessage);
  }
}

function processTemplateWithInterpolation(
  quasi: t.TemplateLiteral,
  path: NodePath,
  fs: TransformFS,
  compiledFunctions: VindurPluginState['compiledFunctions'],
  importedFunctions: Map<string, string>,
  variableName: string | undefined,
  usedFunctions: Set<string>,
) {
  let cssContent = '';

  // Process template literal with interpolations
  for (let i = 0; i < quasi.quasis.length; i++) {
    // Add the static string part - use cooked value to preserve formatting
    cssContent += quasi.quasis[i]?.value.cooked ?? '';

    // Add the interpolated expression if it exists
    if (i < quasi.expressions.length) {
      const expression = quasi.expressions[i];
      if (expression && t.isExpression(expression)) {
        const resolvedExpression = processInterpolationExpression(
          expression,
          path,
          fs,
          compiledFunctions,
          importedFunctions,
          variableName,
          usedFunctions,
        );
        cssContent += resolvedExpression;
      }
    }
  }

  return { cssContent };
}

function resolveVariable(variableName: string, path: NodePath): string | null {
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

function resolveBinaryExpression(
  expr: t.BinaryExpression,
  path: NodePath,
): string | null {
  const { left, right, operator } = expr;

  let leftValue: number | null = null;
  let rightValue: number | null = null;

  // Resolve left operand
  const leftLiteral = extractLiteralValue(left);
  if (typeof leftLiteral === 'number') {
    leftValue = leftLiteral;
  } else if (t.isIdentifier(left)) {
    const resolved = resolveVariable(left.name, path);
    if (resolved !== null && !isNaN(Number(resolved))) {
      leftValue = Number(resolved);
    }
  }

  // Resolve right operand
  const rightLiteral = extractLiteralValue(right);
  if (typeof rightLiteral === 'number') {
    rightValue = rightLiteral;
  } else if (t.isIdentifier(right)) {
    const resolved = resolveVariable(right.name, path);
    if (resolved !== null && !isNaN(Number(resolved))) {
      rightValue = Number(resolved);
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

function resolveFunctionCall(
  callExpr: t.CallExpression,
  compiledFunctions: VindurPluginState['compiledFunctions'],
  importedFunctions: Map<string, string>, // Maps function name to file path
  fs: { readFile: (path: string) => string },
  usedFunctions?: Set<string>,
): string | null {
  if (!t.isIdentifier(callExpr.callee)) return null;

  const functionName = callExpr.callee.name;
  const functionFilePath = importedFunctions.get(functionName);

  if (!functionFilePath) return null;

  // Load the function if not already compiled
  if (!compiledFunctions[functionFilePath]?.[functionName]) {
    loadExternalFunction(fs, functionFilePath, functionName, compiledFunctions);
  }

  if (!compiledFunctions[functionFilePath]?.[functionName]) {
    return null;
  }

  const compiledFn = compiledFunctions[functionFilePath][functionName];
  const args = callExpr.arguments;

  // Mark this function as used
  if (usedFunctions) {
    usedFunctions.add(functionName);
  }

  if (compiledFn.type === 'positional') {
    // Handle positional arguments - need to map to parameter names
    const argValues: Record<string, string | number | boolean> = {};

    // Get parameter names from the compiled function
    const paramNames = getParameterNames(compiledFn);

    args.forEach((arg, index) => {
      const paramName = paramNames[index];
      if (paramName && t.isExpression(arg)) {
        const { value, resolved } = extractArgumentValue(arg);
        if (resolved && value !== null) {
          argValues[paramName] = value;
        }
      }
    });

    return evaluateOutput(compiledFn.output, argValues);
  } else {
    // Handle destructured object arguments
    if (args.length === 1 && t.isObjectExpression(args[0])) {
      const argValues: Record<string, string | number | boolean> = {};

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

function loadExternalFunction(
  fs: { readFile: (path: string) => string },
  filePath: string,
  _functionName: string,
  compiledFunctions: VindurPluginState['compiledFunctions'],
): void {
  if (!compiledFunctions[filePath]) {
    // Load and parse the external file

    const fileContent = fs.readFile(filePath);

    // Parse the file to extract vindurFn functions
    babel.transformSync(fileContent, {
      plugins: [
        function extractVindurFunctions(): PluginObj {
          return {
            visitor: {
              ExportNamedDeclaration(path) {
                if (
                  path.node.declaration
                  && t.isVariableDeclaration(path.node.declaration)
                ) {
                  for (const declarator of path.node.declaration.declarations) {
                    if (
                      t.isVariableDeclarator(declarator)
                      && t.isIdentifier(declarator.id)
                      && declarator.init
                      && t.isCallExpression(declarator.init)
                      && t.isIdentifier(declarator.init.callee)
                      && declarator.init.callee.name === 'vindurFn'
                      && declarator.init.arguments.length === 1
                    ) {
                      const arg = declarator.init.arguments[0];
                      if (
                        t.isArrowFunctionExpression(arg)
                        || t.isFunctionExpression(arg)
                      ) {
                        const name = declarator.id.name;
                        const compiledFn = parseFunction(arg);

                        compiledFunctions[filePath] ??= {};
                        compiledFunctions[filePath][name] = compiledFn;
                      }
                    }
                  }
                }
              },
            },
          };
        },
      ],
      parserOpts: { sourceType: 'module', plugins: ['typescript', 'jsx'] },
    });
  }
}

export function createVindurPlugin(
  options: VindurPluginOptions,
  state: VindurPluginState,
): PluginObj {
  const { dev = false, filePath, fs } = options;

  // Generate base hash from file path with 'c' prefix
  const fileHash = `v${murmur2(filePath)}`;
  let classIndex = 1;

  // Track imported functions and their file paths
  const importedFunctions = new Map<string, string>();
  // Track which functions are actually used during CSS processing
  const usedFunctions = new Set<string>();

  // Initialize compiledFunctions for current file if not exists
  state.compiledFunctions[filePath] ??= {};

  return {
    name: 'vindur-css-transform',
    visitor: {
      ImportDeclaration(path) {
        // Track imports from 'vindur' package
        if (path.node.source.value === 'vindur') {
          path.node.specifiers.forEach((specifier) => {
            if (
              t.isImportSpecifier(specifier)
              && t.isIdentifier(specifier.imported)
            ) {
              state.vindurImports.add(specifier.imported.name);
            }
          });
          // Remove the import statement since we're processing the css at build time
          path.remove();
        } else {
          // Track imports from other files (for functions)
          const source = path.node.source.value;
          if (typeof source === 'string') {
            // Resolve relative imports
            let fullPath = source;
            if (source.startsWith('./') || source.startsWith('../')) {
              // Simple relative path resolution (could be more sophisticated)
              fullPath = `${source}.ts`;
            }

            path.node.specifiers.forEach((specifier) => {
              if (
                t.isImportSpecifier(specifier)
                && t.isIdentifier(specifier.imported)
              ) {
                importedFunctions.set(specifier.imported.name, fullPath);
              }
            });
          }
        }
      },
      ExportNamedDeclaration(path) {
        // Handle vindurFn function declarations for compilation
        if (
          path.node.declaration
          && t.isVariableDeclaration(path.node.declaration)
        ) {
          for (const declarator of path.node.declaration.declarations) {
            if (
              t.isVariableDeclarator(declarator)
              && t.isIdentifier(declarator.id)
              && declarator.init
              && t.isCallExpression(declarator.init)
              && t.isIdentifier(declarator.init.callee)
              && declarator.init.callee.name === 'vindurFn'
              && declarator.init.arguments.length === 1
            ) {
              const arg = declarator.init.arguments[0];
              if (
                t.isArrowFunctionExpression(arg)
                || t.isFunctionExpression(arg)
              ) {
                const functionName = declarator.id.name;
                const compiledFn = parseFunction(arg);

                state.compiledFunctions[filePath] ??= {};
                state.compiledFunctions[filePath][functionName] = compiledFn;
              }
            }
          }
        }
      },
      VariableDeclarator(path) {
        // Check if this is a css tagged template assignment
        if (
          state.vindurImports.has('css')
          && path.node.init
          && t.isTaggedTemplateExpression(path.node.init)
          && t.isIdentifier(path.node.init.tag)
          && path.node.init.tag.name === 'css'
          && t.isIdentifier(path.node.id)
        ) {
          const varName = path.node.id.name;
          const { cssContent } = processTemplateWithInterpolation(
            path.node.init.quasi,
            path,
            fs,
            state.compiledFunctions,
            importedFunctions,
            varName,
            usedFunctions,
          );

          // Generate class name based on dev mode
          const className =
            dev ?
              `${fileHash}-${classIndex}-${varName}`
            : `${fileHash}-${classIndex}`;
          classIndex++;

          // Clean up CSS content and store the CSS rule
          const cleanedCss = cssContent.trim();
          state.cssRules.push(`.${className} {\n  ${cleanedCss}\n}`);

          // Replace the tagged template with the class name string
          path.node.init = t.stringLiteral(className);
        }
      },
      TaggedTemplateExpression(path) {
        if (
          state.vindurImports.has('css')
          && t.isIdentifier(path.node.tag)
          && path.node.tag.name === 'css'
        ) {
          const { cssContent } = processTemplateWithInterpolation(
            path.node.quasi,
            path,
            fs,
            state.compiledFunctions,
            importedFunctions,
            undefined,
            usedFunctions,
          );

          // Generate class name with hash and index (no varName for direct usage)
          const className = `${fileHash}-${classIndex}`;
          classIndex++;

          // Clean up CSS content and store the CSS rule
          const cleanedCss = cssContent.trim();
          state.cssRules.push(`.${className} {\n  ${cleanedCss}\n}`);

          // Replace the tagged template with the class name string
          path.replaceWith(t.stringLiteral(className));
        }
      },
    },
    pre() {
      state.cssRules.length = 0;
      state.vindurImports.clear();
      classIndex = 1;
      usedFunctions.clear();
    },
    post(file) {
      // Remove unused function imports
      file.path.traverse({
        ImportDeclaration(path) {
          const source = path.node.source.value;
          if (
            typeof source === 'string'
            && (source.startsWith('./') || source.startsWith('../'))
          ) {
            // Filter out unused function imports
            const unusedSpecifiers: t.ImportSpecifier[] = [];
            const usedSpecifiers: t.ImportSpecifier[] = [];

            path.node.specifiers.forEach((specifier) => {
              if (
                t.isImportSpecifier(specifier)
                && t.isIdentifier(specifier.imported)
              ) {
                const functionName = specifier.imported.name;
                // Remove functions that were used during CSS processing (they're compiled away)
                if (
                  importedFunctions.has(functionName)
                  && usedFunctions.has(functionName)
                ) {
                  unusedSpecifiers.push(specifier);
                } else {
                  usedSpecifiers.push(specifier);
                }
              } else if (t.isImportSpecifier(specifier)) {
                usedSpecifiers.push(specifier);
              }
            });

            if (unusedSpecifiers.length > 0) {
              if (usedSpecifiers.length === 0) {
                // Remove the entire import statement if no functions are used
                path.remove();
              } else {
                // Remove only unused specifiers
                path.node.specifiers = usedSpecifiers;
              }
            }
          }
        },
      });
    },
  };
}
