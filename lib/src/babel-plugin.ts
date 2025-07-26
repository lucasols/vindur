import type { PluginObj } from '@babel/core';
import * as babel from '@babel/core';
import { types as t } from '@babel/core';
import generate from '@babel/generator';
import { murmur2 } from '@ls-stack/utils/hash';
import { createExtractVindurFunctionsPlugin } from './extract-vindur-functions-plugin';
import { parseFunction } from './function-parser';
import type { CompiledFunction } from './types';
import {
  type CssProcessingContext,
  processStyledTemplate,
  processStyledExtension,
  processGlobalStyle,
} from './css-processing';

export type DebugLogger = { log: (message: string) => void };

export type VindurPluginState = {
  cssRules: string[];
  vindurImports: Set<string>;
  styledComponents: Map<string, { element: string; className: string }>;
  cssVariables: Map<string, string>; // Track css tagged template variables
};

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
        // Create processing context
        const context: CssProcessingContext = {
          fs,
          compiledFunctions: transformFunctionCache,
          importedFunctions,
          usedFunctions,
          state,
          path,
          debug,
          loadExternalFunction,
        };

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
          const result = processStyledTemplate(
            path.node.init.quasi,
            context,
            varName,
            'css',
            dev,
            fileHash,
            classIndex,
          );
          classIndex++;

          // Track the CSS variable for future reference
          state.cssVariables.set(varName, result.finalClassName);

          // Replace the tagged template with the class name string
          path.node.init = t.stringLiteral(result.finalClassName);
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
          const result = processStyledTemplate(
            path.node.init.quasi,
            context,
            varName,
            `styled.${tagName}`,
            dev,
            fileHash,
            classIndex,
          );
          classIndex++;

          // Store the styled component mapping
          state.styledComponents.set(varName, {
            element: tagName,
            className: result.finalClassName,
          });

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
          const result = processStyledExtension(
            path.node.init.quasi,
            context,
            varName,
            extendedName,
            dev,
            fileHash,
            classIndex,
          );
          classIndex++;

          // Get the extended component info for element inheritance
          const extendedInfo = state.styledComponents.get(extendedName);
          if (!extendedInfo) {
            throw new Error(
              `Cannot extend "${extendedName}": it is not a styled component. Only styled components can be extended.`,
            );
          }

          // Store the extended styled component mapping
          state.styledComponents.set(varName, {
            element: extendedInfo.element,
            className: result.finalClassName,
          });

          // Remove the styled component declaration
          path.remove();
        } else if (
          state.vindurImports.has('createGlobalStyle')
          && path.node.init
          && t.isTaggedTemplateExpression(path.node.init)
          && t.isIdentifier(path.node.init.tag)
          && path.node.init.tag.name === 'createGlobalStyle'
        ) {
          processGlobalStyle(path.node.init.quasi, context);

          // Remove the createGlobalStyle declaration since it doesn't produce a value
          path.remove();
        }
      },
      TaggedTemplateExpression(path) {
        // Create processing context
        const context: CssProcessingContext = {
          fs,
          compiledFunctions: transformFunctionCache,
          importedFunctions,
          usedFunctions,
          state,
          path,
          debug,
          loadExternalFunction,
        };

        if (
          state.vindurImports.has('css')
          && t.isIdentifier(path.node.tag)
          && path.node.tag.name === 'css'
        ) {
          const result = processStyledTemplate(
            path.node.quasi,
            context,
            undefined,
            'css',
            dev,
            fileHash,
            classIndex,
          );
          classIndex++;

          // Replace the tagged template with the class name string
          path.replaceWith(t.stringLiteral(result.finalClassName));
        } else if (
          state.vindurImports.has('createGlobalStyle')
          && t.isIdentifier(path.node.tag)
          && path.node.tag.name === 'createGlobalStyle'
        ) {
          processGlobalStyle(path.node.quasi, context);

          // Remove createGlobalStyle expression since it produces no output
          if (t.isExpressionStatement(path.parent)) {
            // Remove the entire expression statement
            path.parentPath.remove();
          } else {
            // If it's part of another expression, replace with void 0
            path.replaceWith(t.unaryExpression('void', t.numericLiteral(0)));
          }
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
            const spreadAttrs = attributes.filter(
              (attr): attr is t.JSXSpreadAttribute =>
                t.isJSXSpreadAttribute(attr),
            );

            // Validate spread expressions - only allow simple identifiers
            for (const attr of spreadAttrs) {
              if (!t.isIdentifier(attr.argument)) {
                const expressionCode = generate(attr.argument).code;
                throw new Error(
                  `Unsupported spread expression "${expressionCode}" used in vindur styled component. Only references to variables are allowed in spread expressions. Extract them to a variable and use that variable in the spread expression.`,
                );
              }
            }
            const classNameAttrs = attributes.filter(
              (attr): attr is t.JSXAttribute =>
                t.isJSXAttribute(attr)
                && t.isJSXIdentifier(attr.name)
                && attr.name.name === 'className',
            );
            const existingClassNameAttr =
              classNameAttrs[classNameAttrs.length - 1]; // Get the last className attr

            if (spreadAttrs.length > 0) {
              // Find the last spread index
              const lastSpreadIndex = Math.max(
                ...spreadAttrs.map((attr) => attributes.indexOf(attr)),
              );

              // Only apply mergeWithSpread logic to the final className attribute
              if (existingClassNameAttr) {
                const finalClassNameIndex = attributes.indexOf(
                  existingClassNameAttr,
                );
                const hasSpreadsBeforeFinalClassName =
                  lastSpreadIndex < finalClassNameIndex;
                const hasMultipleClassNames = classNameAttrs.length > 1;

                if (
                  hasSpreadsBeforeFinalClassName
                  && !hasMultipleClassNames
                  && t.isStringLiteral(existingClassNameAttr.value)
                ) {
                  // Single className comes after spreads - static merge, no mergeWithSpread needed
                  existingClassNameAttr.value.value = `${styledInfo.className} ${existingClassNameAttr.value.value}`;
                } else {
                  // Multiple classNames OR final className comes before/among spreads - needs mergeWithSpread
                  state.vindurImports.add('mergeWithSpread');

                  // Build the spread props array
                  const spreadPropsArray = spreadAttrs.map(
                    (attr) => attr.argument,
                  );

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
                      t.stringLiteral(baseClassName),
                    ],
                  );

                  // Replace the final className with merge call
                  existingClassNameAttr.value =
                    t.jsxExpressionContainer(mergeCall);
                }
              } else {
                // No existing className - add one with mergeWithSpread
                state.vindurImports.add('mergeWithSpread');

                const spreadPropsArray = spreadAttrs.map(
                  (attr) => attr.argument,
                );
                const mergeCall = t.callExpression(
                  t.identifier('mergeWithSpread'),
                  [
                    t.arrayExpression(spreadPropsArray),
                    t.stringLiteral(styledInfo.className),
                  ],
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
      state.cssVariables.clear();
      classIndex = 1;
      usedFunctions.clear();
    },
    post(file) {
      // Resolve forward references in CSS rules
      state.cssRules = state.cssRules.map(cssRule => {
        let resolvedRule = cssRule;
        // Find all forward reference placeholders
        const forwardRefRegex = /__FORWARD_REF__(\w+)__/g;
        let match;
        while ((match = forwardRefRegex.exec(cssRule)) !== null) {
          const componentName = match[1];
          if (!componentName) {
            throw new Error('Invalid forward reference placeholder found');
          }
          const styledComponent = state.styledComponents.get(componentName);
          if (styledComponent) {
            // Replace the placeholder with the actual class name
            resolvedRule = resolvedRule.replace(
              match[0], 
              `.${styledComponent.className}`
            );
          } else {
            throw new Error(
              `Forward reference to undefined styled component: ${componentName}. Make sure the component is defined in the same file.`
            );
          }
        }
        return resolvedRule;
      });

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
              if (
                state.vindurImports.has('mergeWithSpread')
                && !hasMergeWithSpread
              ) {
                specifiersToKeep.push(
                  t.importSpecifier(
                    t.identifier('mergeWithSpread'),
                    t.identifier('mergeWithSpread'),
                  ),
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
              const resolvedPath = resolveImportPath(
                source,
                importAliasesArray,
              );
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
