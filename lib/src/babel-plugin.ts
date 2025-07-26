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
import { createExtractVindurFunctionsPlugin } from './extract-vindur-functions-plugin';
import { parseFunction } from './function-parser';
import type { TransformFS } from './transform';
import type { CompiledFunction, FunctionArg } from './types';

export type DebugLogger = { log: (message: string) => void };

export type FunctionCache = {
  [filePath: string]: { [functionName: string]: CompiledFunction };
};

export type PluginFS = { readFile: (path: string) => string };

export type ImportedFunctions = Map<string, string>;

export type VindurPluginOptions = {
  dev?: boolean;
  debug?: DebugLogger;
  filePath: string;
  fs: PluginFS;
  transformFunctionCache: FunctionCache;
  importAliases: Record<string, string>;
};

export type VindurPluginState = {
  cssRules: string[];
  vindurImports: Set<string>;
  styledComponents: Map<string, { element: string; className: string }>;
};

function processInterpolationExpression(
  expression: t.Expression,
  path: NodePath,
  fs: TransformFS,
  compiledFunctions: FunctionCache,
  importedFunctions: ImportedFunctions,
  variableName: string | undefined,
  usedFunctions: Set<string>,
  tagType: 'css' | 'styled',
  debug?: DebugLogger,
): string {
  if (t.isIdentifier(expression)) {
    const resolvedValue = resolveVariable(expression.name, path);
    if (resolvedValue !== null) {
      return resolvedValue;
    } else {
      const varContext =
        variableName ? `... ${variableName} = ${tagType}` : tagType;
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
      tagType,
      debug,
    );
    return nested.cssContent;
  } else if (t.isCallExpression(expression)) {
    const resolved = resolveFunctionCall(
      expression,
      compiledFunctions,
      importedFunctions,
      fs,
      usedFunctions,
      path,
      debug,
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
  } else {
    const expressionSource = generate(expression).code;
    const varContext =
      variableName ? `... ${variableName} = ${tagType}` : tagType;
    const errorMessage = `Invalid interpolation used at \`${varContext}\` ... \${${expressionSource}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`;
    throw new Error(errorMessage);
  }
}

function processTemplateWithInterpolation(
  quasi: t.TemplateLiteral,
  path: NodePath,
  fs: TransformFS,
  compiledFunctions: FunctionCache,
  importedFunctions: ImportedFunctions,
  variableName: string | undefined,
  usedFunctions: Set<string>,
  tagType: string,
  debug?: DebugLogger,
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
          tagType.includes('styled') ? 'styled' : 'css',
          debug,
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
  compiledFunctions: FunctionCache,
  importedFunctions: ImportedFunctions, // Maps function name to file path
  fs: PluginFS,
  usedFunctions: Set<string>,
  path: NodePath,
  debug?: DebugLogger,
): string | null {
  if (!t.isIdentifier(callExpr.callee)) return null;

  const functionName = callExpr.callee.name;
  const functionFilePath = importedFunctions.get(functionName);

  if (!functionFilePath) return null;

  // Load the function (validation happens here, throws on error)
  const compiledFn = loadExternalFunction(
    fs,
    functionFilePath,
    functionName,
    compiledFunctions,
    debug,
  );
  const args = callExpr.arguments;

  // Mark this function as used
  usedFunctions.add(functionName);

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
        const { value, resolved } = extractArgumentValue(arg, path);
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

function resolveImportPath(
  source: string,
  importAliases: [string, string][],
): string | null {
  // Check for alias imports
  for (const [alias, aliasPath] of importAliases) {
    if (source.startsWith(alias)) {
      const resolvedPath = source.replace(alias, aliasPath);
      return `${resolvedPath}.ts`;
    }
  }

  // Return as-is for all other imports (relative, absolute, or package imports)
  return null;
}

function loadExternalFunction(
  fs: PluginFS,
  filePath: string,
  functionName: string,
  compiledFunctions: FunctionCache,
  debug?: DebugLogger,
): CompiledFunction {
  // Check if already cached
  if (compiledFunctions[filePath]?.[functionName]) {
    debug?.log(
      `[vindur:cache] Cache HIT for function "${functionName}" in ${filePath}`,
    );
    return compiledFunctions[filePath][functionName];
  }

  // Load and parse the external file
  const fileContent = fs.readFile(filePath);

  // Parse the file to extract vindurFn functions
  babel.transformSync(fileContent, {
    filename: filePath,
    plugins: [
      createExtractVindurFunctionsPlugin(filePath, compiledFunctions, debug),
    ],
    parserOpts: { sourceType: 'module', plugins: ['typescript', 'jsx'] },
  });

  // Check if the requested function was found and is properly wrapped
  const compiledFn = compiledFunctions[filePath]?.[functionName];
  if (!compiledFn) {
    // Check if function exists but is not properly wrapped with vindurFn
    if (fileContent.includes(`export const ${functionName}`)) {
      throw new Error(
        `called a invalid vindur function, style functions must be defined with "vindurFn(() => ...)" function`,
      );
    } else {
      throw new Error(`Function "${functionName}" not found in ${filePath}`);
    }
  }

  return compiledFn;
}

export function createVindurPlugin(
  options: VindurPluginOptions,
  state: VindurPluginState,
): PluginObj {
  const {
    dev = false,
    debug,
    filePath,
    fs,
    transformFunctionCache,
    importAliases = {},
  } = options;

  // Generate base hash from file path with 'c' prefix
  const fileHash = `v${murmur2(filePath)}`;
  let classIndex = 1;

  // Track imported functions and their file paths
  const importedFunctions = new Map<string, string>();
  // Track which functions are actually used during CSS processing
  const usedFunctions = new Set<string>();

  // Initialize compiledFunctions for current file if not exists
  transformFunctionCache[filePath] ??= {};

  const importAliasesArray = Object.entries(importAliases);

  return {
    name: 'vindur-css-transform',
    visitor: {
      ImportDeclaration(path) {
        // Track imports from 'vindur' package
        if (path.node.source.value === 'vindur') {
          for (const specifier of path.node.specifiers) {
            if (
              t.isImportSpecifier(specifier)
              && t.isIdentifier(specifier.imported)
            ) {
              state.vindurImports.add(specifier.imported.name);
            }
          }
          // Don't remove the import statement immediately - we'll handle it in post()
          path.skip();
        } else {
          // Track imports from other files (for functions)
          const source = path.node.source.value;
          if (typeof source === 'string') {
            const resolvedPath = resolveImportPath(source, importAliasesArray);

            if (resolvedPath === null) {
              debug?.log(
                `[vindur:import] ${source} is not an alias import, skipping`,
              );
              return;
            }

            debug?.log(`[vindur:import] ${source} resolved to ${resolvedPath}`);

            for (const specifier of path.node.specifiers) {
              if (
                t.isImportSpecifier(specifier)
                && t.isIdentifier(specifier.imported)
              ) {
                importedFunctions.set(specifier.imported.name, resolvedPath);
              }
            }
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

                const compiledFn = parseFunction(arg, functionName);

                transformFunctionCache[filePath] ??= {};
                transformFunctionCache[filePath][functionName] = compiledFn;
              } else {
                throw new Error(
                  `vindurFn must be called with a function expression, got ${typeof arg} in function "${declarator.id.name}"`,
                );
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
            transformFunctionCache,
            importedFunctions,
            varName,
            usedFunctions,
            'css',
            debug,
          );

          // Generate class name based on dev mode
          const className =
            dev ?
              `${fileHash}-${classIndex}-${varName}`
            : `${fileHash}-${classIndex}`;
          classIndex++;

          // Clean up CSS content and store the CSS rule
          const cleanedCss = cleanCss(cssContent);
          // Only add CSS rule if there's actual content
          if (cleanedCss.trim()) {
            state.cssRules.push(`.${className} {\n  ${cleanedCss}\n}`);
          }

          // Replace the tagged template with the class name string
          path.node.init = t.stringLiteral(className);
        } else if (
          state.vindurImports.has('styled')
          && path.node.init
          && t.isTaggedTemplateExpression(path.node.init)
          && t.isMemberExpression(path.node.init.tag)
          && t.isIdentifier(path.node.init.tag.object)
          && path.node.init.tag.object.name === 'styled'
          && t.isIdentifier(path.node.init.tag.property)
          && t.isIdentifier(path.node.id)
        ) {
          // Handle styled.div`` variable assignments
          const varName = path.node.id.name;
          const tagName = path.node.init.tag.property.name;
          const { cssContent } = processTemplateWithInterpolation(
            path.node.init.quasi,
            path,
            fs,
            transformFunctionCache,
            importedFunctions,
            varName,
            usedFunctions,
            `styled.${tagName}`,
            debug,
          );

          // Generate class name based on dev mode
          const className =
            dev ?
              `${fileHash}-${classIndex}-${varName}`
            : `${fileHash}-${classIndex}`;
          classIndex++;

          // Clean up CSS content and store the CSS rule
          const cleanedCss = cleanCss(cssContent);
          // Only add CSS rule if there's actual content
          if (cleanedCss.trim()) {
            state.cssRules.push(`.${className} {\n  ${cleanedCss}\n}`);
          }

          // Store the styled component mapping
          state.styledComponents.set(varName, { element: tagName, className });

          // Remove the styled component declaration
          path.remove();
        } else if (
          state.vindurImports.has('styled')
          && path.node.init
          && t.isTaggedTemplateExpression(path.node.init)
          && t.isCallExpression(path.node.init.tag)
          && t.isIdentifier(path.node.init.tag.callee)
          && path.node.init.tag.callee.name === 'styled'
          && path.node.init.tag.arguments.length === 1
          && t.isIdentifier(path.node.id)
        ) {
          // Handle styled(Component)`` variable assignments
          const varName = path.node.id.name;
          const extendedArg = path.node.init.tag.arguments[0];

          if (!t.isIdentifier(extendedArg)) {
            throw new Error(
              'styled() can only extend identifiers (components or css variables)',
            );
          }

          const extendedName = extendedArg.name;

          // Process the CSS content
          const { cssContent } = processTemplateWithInterpolation(
            path.node.init.quasi,
            path,
            fs,
            transformFunctionCache,
            importedFunctions,
            varName,
            usedFunctions,
            `styled(${extendedName})`,
            debug,
          );

          // Generate class name based on dev mode
          const className =
            dev ?
              `${fileHash}-${classIndex}-${varName}`
            : `${fileHash}-${classIndex}`;
          classIndex++;

          // Clean up CSS content and store the CSS rule
          const cleanedCss = cleanCss(cssContent);
          // Only add CSS rule if there's actual content
          if (cleanedCss.trim()) {
            state.cssRules.push(`.${className} {\n  ${cleanedCss}\n}`);
          }

          // Check if extending a styled component
          const extendedInfo = state.styledComponents.get(extendedName);

          if (!extendedInfo) {
            throw new Error(
              `Cannot extend "${extendedName}": it is not a styled component. Only styled components can be extended.`,
            );
          }

          // Extending a styled component - inherit the element and merge classes
          state.styledComponents.set(varName, {
            element: extendedInfo.element,
            className:
              cleanedCss.trim() ?
                `${extendedInfo.className} ${className}`
              : extendedInfo.className,
          });

          // Remove the styled component declaration
          path.remove();
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
            transformFunctionCache,
            importedFunctions,
            undefined,
            usedFunctions,
            'css',
            debug,
          );

          // Generate class name with hash and index (no varName for direct usage)
          const className = `${fileHash}-${classIndex}`;
          classIndex++;

          // Clean up CSS content and store the CSS rule
          const cleanedCss = cleanCss(cssContent);
          // Only add CSS rule if there's actual content
          if (cleanedCss.trim()) {
            state.cssRules.push(`.${className} {\n  ${cleanedCss}\n}`);
          }

          // Replace the tagged template with the class name string
          path.replaceWith(t.stringLiteral(className));
        } else if (
          state.vindurImports.has('styled')
          && t.isMemberExpression(path.node.tag)
          && t.isIdentifier(path.node.tag.object)
          && path.node.tag.object.name === 'styled'
          && t.isIdentifier(path.node.tag.property)
        ) {
          // For inline styled usage, we can't directly map it
          // So we keep it as an error or handle it differently
          throw new Error(
            'Inline styled component usage is not supported. Please assign styled components to a variable first.',
          );
        }
      },
      JSXElement(path) {
        if (t.isJSXIdentifier(path.node.openingElement.name)) {
          const elementName = path.node.openingElement.name.name;
          const styledInfo = state.styledComponents.get(elementName);

          if (styledInfo) {
            // Replace the styled component with the actual HTML element
            path.node.openingElement.name = t.jsxIdentifier(styledInfo.element);
            if (path.node.closingElement) {
              path.node.closingElement.name = t.jsxIdentifier(
                styledInfo.element,
              );
            }

            // Check for spread attributes
            const attributes = path.node.openingElement.attributes;
            const spreadAttrs = attributes.filter((attr): attr is t.JSXSpreadAttribute => 
              t.isJSXSpreadAttribute(attr)
            );

            // Validate spread expressions - only allow simple identifiers
            for (const attr of spreadAttrs) {
              if (!t.isIdentifier(attr.argument)) {
                const expressionCode = generate(attr.argument).code;
                throw new Error(
                  `${path.hub.file.opts.filename || '/test.tsx'}: Unsupported spread expression "${expressionCode}" used in vindur styled component. Only references to variables are allowed in spread expressions. Extract them to a variable and use that variable in the spread expression.`
                );
              }
            }
            const classNameAttrs = attributes.filter(
              (attr): attr is t.JSXAttribute =>
                t.isJSXAttribute(attr)
                && t.isJSXIdentifier(attr.name)
                && attr.name.name === 'className',
            );
            const existingClassNameAttr = classNameAttrs[classNameAttrs.length - 1]; // Get the last className attr

            if (spreadAttrs.length > 0) {
              // Find the last spread index
              const lastSpreadIndex = Math.max(...spreadAttrs.map(attr => attributes.indexOf(attr)));
              
              // Only apply mergeWithSpread logic to the final className attribute
              if (existingClassNameAttr) {
                const finalClassNameIndex = attributes.indexOf(existingClassNameAttr);
                const hasSpreadsBeforeFinalClassName = lastSpreadIndex < finalClassNameIndex;
                const hasMultipleClassNames = classNameAttrs.length > 1;
                
                if (hasSpreadsBeforeFinalClassName && !hasMultipleClassNames && t.isStringLiteral(existingClassNameAttr.value)) {
                  // Single className comes after spreads - static merge, no mergeWithSpread needed
                  existingClassNameAttr.value.value = `${styledInfo.className} ${existingClassNameAttr.value.value}`;
                } else {
                  // Multiple classNames OR final className comes before/among spreads - needs mergeWithSpread
                  state.vindurImports.add('mergeWithSpread');
                  
                  // Build the spread props array
                  const spreadPropsArray = spreadAttrs.map(attr => attr.argument);
                  
                  // Include the final className value in the base
                  let baseClassName = styledInfo.className;
                  if (t.isStringLiteral(existingClassNameAttr.value)) {
                    baseClassName = `${styledInfo.className} ${existingClassNameAttr.value.value}`;
                  }

                  // Create the mergeWithSpread call
                  const mergeCall = t.callExpression(
                    t.identifier('mergeWithSpread'),
                    [
                      t.arrayExpression(spreadPropsArray),
                      t.stringLiteral(baseClassName)
                    ]
                  );

                  // Replace the final className with merge call
                  existingClassNameAttr.value = t.jsxExpressionContainer(mergeCall);
                }
              } else {
                // No existing className - add one with mergeWithSpread
                state.vindurImports.add('mergeWithSpread');
                
                const spreadPropsArray = spreadAttrs.map(attr => attr.argument);
                const mergeCall = t.callExpression(
                  t.identifier('mergeWithSpread'),
                  [
                    t.arrayExpression(spreadPropsArray),
                    t.stringLiteral(styledInfo.className)
                  ]
                );

                attributes.push(
                  t.jsxAttribute(
                    t.jsxIdentifier('className'),
                    t.jsxExpressionContainer(mergeCall),
                  ),
                );
              }
            } else {
              // Handle normal className merging (no spread props)
              if (existingClassNameAttr) {
                // Merge with existing className
                if (t.isStringLiteral(existingClassNameAttr.value)) {
                  // If it's a string literal, concatenate
                  existingClassNameAttr.value.value = `${styledInfo.className} ${existingClassNameAttr.value.value}`;
                } else if (
                  t.isJSXExpressionContainer(existingClassNameAttr.value)
                ) {
                  // If it's an expression, create a template literal
                  existingClassNameAttr.value = t.jsxExpressionContainer(
                    t.templateLiteral(
                      [
                        t.templateElement(
                          {
                            cooked: `${styledInfo.className} `,
                            raw: `${styledInfo.className} `,
                          },
                          false,
                        ),
                        t.templateElement({ cooked: '', raw: '' }, true),
                      ],
                      [
                        (
                          t.isJSXEmptyExpression(
                            existingClassNameAttr.value.expression,
                          )
                        ) ?
                          t.stringLiteral('')
                        : existingClassNameAttr.value.expression,
                      ],
                    ),
                  );
                }
              } else {
                // Add new className attribute
                attributes.push(
                  t.jsxAttribute(
                    t.jsxIdentifier('className'),
                    t.stringLiteral(styledInfo.className),
                  ),
                );
              }
            }
          }
        }
      },
    },
    pre() {
      state.cssRules.length = 0;
      state.vindurImports.clear();
      state.styledComponents.clear();
      classIndex = 1;
      usedFunctions.clear();
    },
    post(file) {
      // Handle vindur imports and remove unused function imports
      file.path.traverse({
        ImportDeclaration(path) {
          const source = path.node.source.value;
          if (typeof source === 'string') {
            if (source === 'vindur') {
              // Handle vindur imports - keep only mergeWithSpread if it's used
              const specifiersToKeep: t.ImportSpecifier[] = [];
              let hasMergeWithSpread = false;
              
              for (const specifier of path.node.specifiers) {
                if (
                  t.isImportSpecifier(specifier)
                  && t.isIdentifier(specifier.imported)
                  && specifier.imported.name === 'mergeWithSpread'
                ) {
                  hasMergeWithSpread = true;
                  if (state.vindurImports.has('mergeWithSpread')) {
                    specifiersToKeep.push(specifier);
                  }
                }
              }
              
              // Add mergeWithSpread import if needed but not already present
              if (state.vindurImports.has('mergeWithSpread') && !hasMergeWithSpread) {
                specifiersToKeep.push(
                  t.importSpecifier(
                    t.identifier('mergeWithSpread'),
                    t.identifier('mergeWithSpread')
                  )
                );
              }
              
              if (specifiersToKeep.length > 0) {
                // Keep the import but only with the needed specifiers
                path.node.specifiers = specifiersToKeep;
              } else {
                // Remove the entire vindur import if nothing is needed
                path.remove();
              }
            } else {
              // Check if this is a relative import or an alias import that was resolved
              const isRelativeImport =
                source.startsWith('./') || source.startsWith('../');
              const resolvedPath = resolveImportPath(source, importAliasesArray);
              const isResolvedAliasImport = resolvedPath !== null;

              if (isRelativeImport || isResolvedAliasImport) {
                // Filter out unused function imports
                const unusedSpecifiers: t.ImportSpecifier[] = [];
                const usedSpecifiers: t.ImportSpecifier[] = [];

                for (const specifier of path.node.specifiers) {
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
                }

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
            }
          }
        },
      });
    },
  };
}

const doubleSemicolonRegex = /;\s*;/g;

function cleanCss(css: string) {
  let cleaned = css.trim().replace(doubleSemicolonRegex, ';'); // Remove double semicolons

  if (cleaned.startsWith(';')) {
    cleaned = cleaned.slice(1).trim();
  }

  return cleaned;
}
