import type { PluginObj } from '@babel/core';
import * as babel from '@babel/core';
import { types as t } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import { murmur2 } from '@ls-stack/utils/hash';
import type { CssProcessingContext } from './css-processing';
import type { StyleFlag } from './visitor-handlers/style-flags-utils';
import type { CssRuleWithLocation } from './css-source-map';
import { TransformError, TransformWarning } from './custom-errors';
import {
  createExtractVindurFeaturesPlugin,
  type ExtractedVindurFeatures,
} from './extract-vindur-features-plugin';
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
import { handleJsxStyleProp } from './visitor-handlers/jsx-style-prop-handlers';
import { handleJsxStyledComponent } from './visitor-handlers/jsx-styled-handlers';
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
  handleLocalVindurFnError,
  handleStableIdCall,
  handleStaticThemeColorsAssignment,
  handleStyledElementAssignment,
  handleStyledExtensionAssignment,
  handleWithComponentAssignment,
} from './visitor-handlers/variable-handlers';

export type DebugLogger = {
  log: (message: string) => void;
  warn?: (message: string) => void;
};

export type CssVariableInfo = {
  className: string;
  cssContent: string;
};

export type ExtractedFileRecord = {
  cssVariables: Map<string, CssVariableInfo>;
  keyframes: Map<string, string>;
  constants: Map<string, string | number>;
  objectConstants: Map<string, Record<string, string | number>>;
  themeColors: Map<string, Record<string, string>>;
};

export type VindurPluginState = {
  cssRules: CssRuleWithLocation[];
  vindurImports: Set<string>;
  styledComponents: Map<
    string,
    {
      element: string;
      className: string;
      isExported: boolean;
      styleFlags?: StyleFlag[];
      attrs?: boolean; // Whether component has attrs (actual expression stored separately)
      attrsExpression?: t.ObjectExpression; // The original attrs expression
    }
  >;
  cssVariables: Map<string, CssVariableInfo>; // Track css tagged template variables
  keyframes: Map<string, string>; // Track keyframes animation names
  themeColors?: Map<string, Record<string, string>>; // Track createStaticThemeColors variables
  dynamicColors?: Map<string, string>; // Track createDynamicCssColor variables
  scopedVariables?: Map<string, { index: number; originalName: string }>; // Track scoped CSS variables at file level
  potentiallyUndeclaredScopedVariables?: Set<string>; // Track variables used in CSS but not declared (may be provided via style props)
  cxClassIndices?: Map<string, number>; // Track cx class names and their assigned indices at file level
  elementsWithCssContext?: WeakSet<t.JSXElement>; // Track elements that have been processed by css prop handler
  sourceContent?: string; // Track source content for source map generation
  currentLayer?: string; // Track the current CSS layer for the current styled component
  styleDependencies?: Set<string>; // Track external files loaded during transformation (for hot-reload)
  // Cache extraction results across a single transform to avoid duplicate CSS emission
  extractedFiles?: Map<string, ExtractedFileRecord>;
};

export type FunctionCache = {
  [filePath: string]: { [functionName: string]: CompiledFunction };
};

export type DynamicColorCache = {
  [filePath: string]: { [varName: string]: string };
};

export type PluginFS = {
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
};

export type ImportedFunctions = Map<string, string>;

export type VindurPluginOptions = {
  dev?: boolean;
  debug?: DebugLogger;
  filePath: string;
  sourceContent: string;
  fs: PluginFS;
  transformFunctionCache: FunctionCache;
  dynamicColorCache: DynamicColorCache;
  importAliases: Record<string, string>;
  onWarning?: (warning: TransformWarning) => void;
};

function loadExternalFunction(
  fs: PluginFS,
  filePath: string,
  functionName: string,
  compiledFunctions: FunctionCache,
  styleDependencies?: Set<string>,
  debug?: DebugLogger,
  callLoc?: t.SourceLocation | null,
): CompiledFunction {
  // Track this file as a dependency
  if (styleDependencies) {
    styleDependencies.add(filePath);
    debug?.log(`[vindur:deps] Added dependency: ${filePath}`);
  }

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
      throw new TransformError(
        `called a invalid vindur function, style functions must be defined with "vindurFn(() => ...)" function`,
        notNullish(callLoc),
        { filename: filePath },
      );
    } else {
      throw new TransformError(
        `Function "${functionName}" not found in ${filePath}`,
        notNullish(callLoc),
        { filename: filePath, ignoreInLint: true },
      );
    }
  }

  return compiledFn;
}

export function loadExternalDynamicColors(
  fs: PluginFS,
  filePath: string,
  dynamicColorCache: DynamicColorCache,
  styleDependencies?: Set<string>,
  debug?: DebugLogger,
): void {
  // Track this file as a dependency
  if (styleDependencies) {
    styleDependencies.add(filePath);
    debug?.log(`[vindur:deps] Added dependency: ${filePath}`);
  }

  // Check if already processed
  if (dynamicColorCache[filePath]) {
    debug?.log(`[vindur:dynamic-colors] Cache HIT for file ${filePath}`);
    return;
  }

  // Load and parse the external file using extraction-only plugin
  const fileContent = fs.readFile(filePath);

  // Create extracted features container
  const extractedFeatures: ExtractedVindurFeatures = {
    cssVariables: new Map(),
    keyframes: new Map(),
    dynamicColors: new Map(),
    themeColors: new Map(),
    styledComponents: new Map(),
  };

  // Use the general extraction plugin to get all features with accurate indices
  const extractionPlugin = createExtractVindurFeaturesPlugin(
    filePath,
    extractedFeatures,
    debug,
  );

  babel.transformSync(fileContent, {
    filename: filePath,
    plugins: [extractionPlugin],
    parserOpts: { sourceType: 'module', plugins: ['typescript', 'jsx'] },
  });

  // Extract dynamic color mappings from the extracted features
  if (extractedFeatures.dynamicColors.size > 0) {
    dynamicColorCache[filePath] ??= {};
    for (const [varName, hashId] of extractedFeatures.dynamicColors) {
      dynamicColorCache[filePath][varName] = hashId;
      debug?.log(
        `[vindur:dynamic-colors] Cached dynamic color "${varName}" -> "${hashId}" from ${filePath}`,
      );
    }
  }

  debug?.log(
    `[vindur:dynamic-colors] Processed dynamic colors from ${filePath}`,
  );
}

export function createVindurPlugin(
  options: VindurPluginOptions,
  state: VindurPluginState,
): PluginObj {
  const {
    dev = false,
    debug,
    filePath,
    sourceContent,
    fs,
    transformFunctionCache,
    dynamicColorCache,
    importAliases = {},
    onWarning,
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

  // Initialize dynamicColorCache for current file if not exists
  dynamicColorCache[filePath] ??= {};

  const importAliasesArray = Object.entries(importAliases);

  return {
    name: 'vindur-css-transform',
    visitor: {
      ImportDeclaration(path) {
        const classIndexRef = { current: idIndex };
        const importHandlerContext = {
          state,
          importedFunctions,
          debug,
          importAliasesArray,
          fileHash,
          classIndex: classIndexRef,
          fs,
          dynamicColorCache,
        };

        if (path.node.source.value === 'vindur') {
          handleVindurImports(path, importHandlerContext);
        } else {
          handleFunctionImports(path, importHandlerContext);
        }

        // Update idIndex from the reference
        idIndex = classIndexRef.current;
      },
      ExportNamedDeclaration(path) {
        const exportHandlerContext = {
          transformFunctionCache,
          filePath,
        };

        handleVindurFnExport(path, exportHandlerContext);
      },
      VariableDeclarator(path) {
        // Create wrapper for loadExternalFunction that tracks dependencies
        function createLoadExternalFunctionWithDeps() {
          return (
            fsArg: PluginFS,
            filePathArg: string,
            functionName: string,
            compiledFunctions: FunctionCache,
            _styleDependencies?: Set<string>,
            debugArg?: DebugLogger,
            callLoc?: t.SourceLocation | null,
          ) => {
            return loadExternalFunction(
              fsArg,
              filePathArg,
              functionName,
              compiledFunctions,
              state.styleDependencies,
              debugArg,
              notNullish(callLoc),
            );
          };
        }
        const loadExternalFunctionWithDeps =
          createLoadExternalFunctionWithDeps();

        // Create processing context
        const context: CssProcessingContext = {
          fs,
          compiledFunctions: transformFunctionCache,
          dynamicColorCache,
          importedFunctions,
          usedFunctions,
          state,
          path,
          debug,
          onWarning,
          dev,
          extractedFiles:
            state.extractedFiles
            ?? (state.extractedFiles = new Map<string, ExtractedFileRecord>()),
          loadExternalFunction: loadExternalFunctionWithDeps,
        };

        const idIndexRef = { current: idIndex };
        const variableHandlerContext = {
          context,
          dev,
          fileHash,
          classIndex: idIndexRef,
          filePath,
        };

        // Try each handler in order - they return true if they handled the node
        if (handleLocalVindurFnError(path, variableHandlerContext)) {
          // This handler throws an error, so it never returns true
        } else if (handleCssVariableAssignment(path, variableHandlerContext)) {
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
          handleWithComponentAssignment(path, variableHandlerContext)
        ) {
          // No idIndex increment for withComponent as it reuses existing classes
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
        // Create wrapper for loadExternalFunction that tracks dependencies
        function createLoadExternalFunctionWithDeps() {
          return (
            fsArg: PluginFS,
            filePathArg: string,
            functionName: string,
            compiledFunctions: FunctionCache,
            _styleDependencies?: Set<string>,
            debugArg?: DebugLogger,
            callLoc?: t.SourceLocation | null,
          ) => {
            return loadExternalFunction(
              fsArg,
              filePathArg,
              functionName,
              compiledFunctions,
              state.styleDependencies,
              debugArg,
              notNullish(callLoc),
            );
          };
        }
        const loadExternalFunctionWithDeps =
          createLoadExternalFunctionWithDeps();

        // Create processing context
        const context: CssProcessingContext = {
          fs,
          compiledFunctions: transformFunctionCache,
          dynamicColorCache,
          importedFunctions,
          usedFunctions,
          state,
          path,
          debug,
          onWarning,
          dev,
          extractedFiles:
            state.extractedFiles
            ?? (state.extractedFiles = new Map<string, ExtractedFileRecord>()),
          loadExternalFunction: loadExternalFunctionWithDeps,
        };

        const classIndexRef = { current: idIndex };
        const taggedTemplateHandlerContext = {
          context,
          dev,
          fileHash,
          classIndex: classIndexRef,
          sourceFilePath: filePath,
          sourceContent,
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
            dynamicColorCache,
            importedFunctions,
            usedFunctions,
            state,
            path,
            debug,
            onWarning,
            dev,
            extractedFiles:
              state.extractedFiles
              ?? (state.extractedFiles = new Map<
                string,
                ExtractedFileRecord
              >()),
            loadExternalFunction,
          }),
          filePath,
          sourceContent,
        });

        // Handle cx prop (before styled component transformation)
        handleJsxCxProp(path, {
          state,
          dev,
          fileHash,
          classIndex: () => idIndex++,
          onWarning,
        });

        // Handle dynamic color prop (before styled component transformation)
        handleJsxDynamicColorProp(path, { state });

        // Handle style prop for scoped variables
        handleJsxStyleProp(path, { state, dev, fileHash, onWarning });

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
      state.sourceContent = sourceContent;
      state.extractedFiles = new Map<string, ExtractedFileRecord>();
      idIndex = 1;
      usedFunctions.clear();
      importedFunctions.clear();
    },
    post(file) {
      const postProcessingContext = {
        state,
        importedFunctions,
        usedFunctions,
        importAliasesArray,
      };

      performPostProcessing(file, postProcessingContext, filePath);
    },
  };
}
