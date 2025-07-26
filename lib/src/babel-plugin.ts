import type { PluginObj } from '@babel/core';
import * as babel from '@babel/core';
import { types as t } from '@babel/core';
import { murmur2 } from '@ls-stack/utils/hash';
import { createExtractVindurFunctionsPlugin } from './extract-vindur-functions-plugin';
import type { CompiledFunction } from './types';
import type { CssProcessingContext } from './css-processing';
import {
  handleVindurImports,
  handleFunctionImports,
  handleVindurFnExport,
  handleCssVariableAssignment,
  handleStyledElementAssignment,
  handleStyledExtensionAssignment,
  handleGlobalStyleVariableAssignment,
  handleCssTaggedTemplate,
  handleGlobalStyleTaggedTemplate,
  handleInlineStyledError,
  handleJsxStyledComponent,
} from './visitor-handlers';

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
        const importHandlerContext = {
          state,
          importedFunctions,
          debug,
          importAliasesArray,
        };

        if (path.node.source.value === 'vindur') {
          handleVindurImports(path, importHandlerContext);
        } else {
          handleFunctionImports(path, importHandlerContext);
        }
      },
      ExportNamedDeclaration(path) {
        const exportHandlerContext = {
          transformFunctionCache,
          filePath,
        };
        
        handleVindurFnExport(path, exportHandlerContext);
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

        const classIndexRef = { current: classIndex };
        const variableHandlerContext = {
          context,
          dev,
          fileHash,
          classIndex: classIndexRef,
        };

        // Try each handler in order - they return true if they handled the node
        if (handleCssVariableAssignment(path, variableHandlerContext)) {
          classIndex = classIndexRef.current;
        } else if (handleStyledElementAssignment(path, variableHandlerContext)) {
          classIndex = classIndexRef.current;
        } else if (handleStyledExtensionAssignment(path, variableHandlerContext)) {
          classIndex = classIndexRef.current;
        } else if (handleGlobalStyleVariableAssignment(path, variableHandlerContext)) {
          // No classIndex increment for global styles
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

        const classIndexRef = { current: classIndex };
        const taggedTemplateHandlerContext = {
          context,
          dev,
          fileHash,
          classIndex: classIndexRef,
        };

        // Try each handler in order - they return true if they handled the node
        if (handleCssTaggedTemplate(path, taggedTemplateHandlerContext)) {
          classIndex = classIndexRef.current;
        } else if (handleGlobalStyleTaggedTemplate(path, taggedTemplateHandlerContext)) {
          // No classIndex increment for global styles
        } else if (handleInlineStyledError(path, { state })) {
          // Error handler - throws exception
        }
      },
      JSXElement(path) {
        handleJsxStyledComponent(path, { state });
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
