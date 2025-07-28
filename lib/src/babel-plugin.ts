import type { PluginObj } from '@babel/core';
import * as babel from '@babel/core';
import { murmur2 } from '@ls-stack/utils/hash';
import type { CssProcessingContext } from './css-processing';
import { createExtractVindurFunctionsPlugin } from './extract-vindur-functions-plugin';
import { performPostProcessing } from './post-processing-handlers';
import type { CompiledFunction } from './types';
import {
  handleFunctionImports,
  handleVindurFnExport,
  handleVindurImports,
} from './visitor-handlers/import-export-handlers';
import { handleJsxCssProp } from './visitor-handlers/jsx-css-prop-handlers';
import { handleJsxCxProp } from './visitor-handlers/jsx-cx-prop-handlers';
import { handleJsxDynamicColorProp } from './visitor-handlers/jsx-dynamic-color-handlers';
import { handleJsxStyledComponent } from './visitor-handlers/jsx-styled-handlers';
import { handleJsxStyleProp } from './visitor-handlers/jsx-style-prop-handlers';
import {
  handleCssTaggedTemplate,
  handleGlobalStyleTaggedTemplate,
  handleInlineStyledError,
  handleKeyframesTaggedTemplate,
} from './visitor-handlers/template-handlers';
import {
  handleCreateClassNameCall,
  handleCssVariableAssignment,
  handleDynamicCssColorAssignment,
  handleGlobalStyleVariableAssignment,
  handleKeyframesVariableAssignment,
  handleStableIdCall,
  handleStaticThemeColorsAssignment,
  handleStyledElementAssignment,
  handleStyledExtensionAssignment,
} from './visitor-handlers/variable-handlers';

export type DebugLogger = { 
  log: (message: string) => void;
  warn?: (message: string) => void;
};

export type VindurPluginState = {
  cssRules: string[];
  vindurImports: Set<string>;
  styledComponents: Map<
    string,
    {
      element: string;
      className: string;
      isExported: boolean;
      styleFlags?: Array<{ propName: string; hashedClassName: string }>;
    }
  >;
  cssVariables: Map<string, string>; // Track css tagged template variables
  keyframes: Map<string, string>; // Track keyframes animation names
  themeColors?: Map<string, Record<string, string>>; // Track createStaticThemeColors variables
  dynamicColors?: Map<string, string>; // Track createDynamicCssColor variables
  scopedVariables?: Map<string, { index: number; originalName: string }>; // Track scoped CSS variables at file level
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
  let idIndex = 1;

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
          extractedFiles: new Map(),
          loadExternalFunction,
        };

        const idIndexRef = { current: idIndex };
        const variableHandlerContext = {
          context,
          dev,
          fileHash,
          classIndex: idIndexRef,
        };

        // Try each handler in order - they return true if they handled the node
        if (handleCssVariableAssignment(path, variableHandlerContext)) {
          idIndex = idIndexRef.current;
        } else if (
          handleStyledElementAssignment(path, variableHandlerContext)
        ) {
          idIndex = idIndexRef.current;
        } else if (
          handleStyledExtensionAssignment(path, variableHandlerContext)
        ) {
          idIndex = idIndexRef.current;
        } else if (
          handleKeyframesVariableAssignment(path, variableHandlerContext)
        ) {
          idIndex = idIndexRef.current;
        } else if (
          handleStaticThemeColorsAssignment(path, variableHandlerContext)
        ) {
          // No classIndex increment for theme colors
        } else if (
          handleDynamicCssColorAssignment(path, variableHandlerContext)
        ) {
          idIndex = idIndexRef.current;
        } else if (
          handleGlobalStyleVariableAssignment(path, variableHandlerContext)
        ) {
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
          extractedFiles: new Map(),
          loadExternalFunction,
        };

        const classIndexRef = { current: idIndex };
        const taggedTemplateHandlerContext = {
          context,
          dev,
          fileHash,
          classIndex: classIndexRef,
        };

        // Try each handler in order - they return true if they handled the node
        if (handleCssTaggedTemplate(path, taggedTemplateHandlerContext)) {
          idIndex = classIndexRef.current;
        } else if (
          handleKeyframesTaggedTemplate(path, taggedTemplateHandlerContext)
        ) {
          idIndex = classIndexRef.current;
        } else if (
          handleGlobalStyleTaggedTemplate(path, taggedTemplateHandlerContext)
        ) {
          // No classIndex increment for global styles
        } else if (
          handleInlineStyledError(path, taggedTemplateHandlerContext)
        ) {
          idIndex = classIndexRef.current;
        }
      },
      JSXElement(path) {
        // Handle css prop first (before styled component transformation)
        // so it can access styled component information
        handleJsxCssProp(path, {
          state,
          dev,
          fileHash,
          classIndex: () => idIndex++,
          cssProcessingContext: () => ({
            fs,
            compiledFunctions: transformFunctionCache,
            importedFunctions,
            usedFunctions,
            state,
            path,
            debug,
            extractedFiles: new Map(),
            loadExternalFunction,
          }),
        });

        // Handle cx prop (before styled component transformation)
        handleJsxCxProp(path, {
          state,
          dev,
          fileHash,
          classIndex: () => idIndex++,
        });

        // Handle dynamic color prop (before styled component transformation)
        handleJsxDynamicColorProp(path, { state });
        
        // Handle style prop for scoped variables
        handleJsxStyleProp(path, { state, dev, fileHash });

        // Handle styled components last (transforms element name)
        handleJsxStyledComponent(path, { state });
      },
      CallExpression(path) {
        const callExpressionContext = {
          state,
          dev,
          fileHash,
          classIndex: () => idIndex++,
        };

        if (!handleStableIdCall(path, callExpressionContext)) {
          handleCreateClassNameCall(path, callExpressionContext);
        }
      },
    },
    pre() {
      state.cssRules.length = 0;
      state.vindurImports.clear();
      state.styledComponents.clear();
      state.cssVariables.clear();
      state.keyframes.clear();
      idIndex = 1;
      usedFunctions.clear();
    },
    post(file) {
      const postProcessingContext = {
        state,
        importedFunctions,
        usedFunctions,
        importAliasesArray,
      };

      performPostProcessing(file, postProcessingContext);
    },
  };
}
