import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import { processTemplateWithInterpolation } from './ast-processing';
import type {
  DebugLogger,
  FunctionCache,
  VindurPluginState,
} from './babel-plugin';
import type { TransformFS } from './transform';
import type { CompiledFunction } from './types';
import { processScopedCssVariables, type ScopedVariableMap } from './scoped-css-variables';

export type CssProcessingContext = {
  fs: TransformFS;
  compiledFunctions: FunctionCache;
  importedFunctions: Map<string, string>;
  usedFunctions: Set<string>;
  state: VindurPluginState;
  path: NodePath;
  debug?: DebugLogger;
  // Cache for external file extractions to prevent duplicate processing  
  extractedFiles: Map<string, { cssVariables: Map<string, string>; keyframes: Map<string, string>; constants: Map<string, string | number>; themeColors: Map<string, Record<string, string>> }>;
  loadExternalFunction: (
    fs: { readFile: (path: string) => string },
    filePath: string,
    functionName: string,
    compiledFunctions: Record<string, Record<string, CompiledFunction>>,
    debug?: { log: (message: string) => void },
  ) => CompiledFunction;
};

export type CssProcessingResult = {
  cssContent: string;
  extensions: string[];
  finalClassName: string;
  scopedVariables?: ScopedVariableMap;
  warnings?: string[];
};

const STYLED_TAG_NAME = 'styled';

export function processCssTemplate(
  quasi: t.TemplateLiteral,
  context: CssProcessingContext,
  variableName: string | undefined,
  tagType: string,
  dev: boolean = false,
): { cssContent: string; extensions: string[] } {
  return processTemplateWithInterpolation(
    quasi,
    context,
    variableName,
    tagType,
    dev,
  );
}

export function generateCssRule(
  className: string,
  cssContent: string,
  extensions: string[],
  state: VindurPluginState,
): string {
  const cleanedCss = cleanCss(cssContent);
  if (!cleanedCss.trim()) {
    return extensions.length > 0 ?
        `${extensions.join(' ')} ${className}`
      : className;
  }

  const cssRule = `.${className} {\n  ${cleanedCss}\n}`;
  
  // Wrap in @layer if a layer is set
  if (state.currentLayer) {
    state.cssRules.push(`@layer ${state.currentLayer} {\n  ${cssRule}\n}`);
    // Clear the current layer after use (per-component basis)
    state.currentLayer = undefined;
  } else {
    state.cssRules.push(cssRule);
  }
  
  return extensions.length > 0 ?
      `${extensions.join(' ')} ${className}`
    : className;
}

export function processStyledTemplate(
  quasi: t.TemplateLiteral,
  context: CssProcessingContext,
  variableName: string | undefined,
  tagType: string,
  dev: boolean,
  fileHash: string,
  classIndex: number,
  classIndexRef?: { current: number },
): CssProcessingResult {
  const { cssContent, extensions } = processCssTemplate(
    quasi,
    context,
    variableName,
    tagType,
    dev,
  );

  // Initialize file-level scoped variables map if needed
  if (!context.state.scopedVariables) {
    context.state.scopedVariables = new Map();
  }

  // Process scoped CSS variables
  const scopedResult = processScopedCssVariables(
    cssContent,
    fileHash,
    dev,
    context.state.scopedVariables,
    classIndexRef,
    context.state.potentiallyUndeclaredScopedVariables,
  );

  // Merge newly found scoped variables into file-level map
  for (const [varName, varInfo] of scopedResult.scopedVariables) {
    if (!context.state.scopedVariables.has(varName)) {
      context.state.scopedVariables.set(varName, varInfo);
    }
  }

  const className = generateClassName(dev, fileHash, classIndex, variableName);
  const finalClassName = generateCssRule(
    className,
    scopedResult.processedCss,
    extensions,
    context.state,
  );

  return { 
    cssContent: scopedResult.processedCss, 
    extensions, 
    finalClassName,
    scopedVariables: context.state.scopedVariables,
    warnings: scopedResult.warnings,
  };
}

export function processStyledExtension(
  quasi: t.TemplateLiteral,
  context: CssProcessingContext,
  variableName: string,
  extendedName: string,
  dev: boolean,
  fileHash: string,
  classIndex: number,
  classIndexRef?: { current: number },
): CssProcessingResult {
  const { cssContent, extensions } = processCssTemplate(
    quasi,
    context,
    variableName,
    `${STYLED_TAG_NAME}(${extendedName})`,
    dev,
  );

  // Initialize file-level scoped variables map if needed
  if (!context.state.scopedVariables) {
    context.state.scopedVariables = new Map();
  }

  // Process scoped CSS variables
  const scopedResult = processScopedCssVariables(
    cssContent,
    fileHash,
    dev,
    context.state.scopedVariables,
    classIndexRef,
    context.state.potentiallyUndeclaredScopedVariables,
  );

  // Merge newly found scoped variables into file-level map
  for (const [varName, varInfo] of scopedResult.scopedVariables) {
    if (!context.state.scopedVariables.has(varName)) {
      context.state.scopedVariables.set(varName, varInfo);
    }
  }

  const className = generateClassName(dev, fileHash, classIndex, variableName);

  // Check if extending a styled component
  const extendedInfo = context.state.styledComponents.get(extendedName);
  if (!extendedInfo) {
    throw new Error(
      `Cannot extend "${extendedName}": it is not a styled component. Only styled components can be extended.`,
    );
  }

  // Clean up CSS content and store the CSS rule
  const cleanedCss = cleanCss(scopedResult.processedCss);
  if (cleanedCss.trim()) {
    const cssRule = `.${className} {\n  ${cleanedCss}\n}`;
    
    // Wrap in @layer if a layer is set
    if (context.state.currentLayer) {
      context.state.cssRules.push(`@layer ${context.state.currentLayer} {\n  ${cssRule}\n}`);
      // Clear the current layer after use (per-component basis)
      context.state.currentLayer = undefined;
    } else {
      context.state.cssRules.push(cssRule);
    }
  }

  // Handle extensions first
  let finalClassName = className;
  if (extensions.length > 0) {
    finalClassName = `${extensions.join(' ')} ${className}`;
  }

  // Extend the styled component - inherit element and merge classes
  const mergedClassName =
    cleanedCss.trim() ?
      `${extendedInfo.className} ${finalClassName}`
    : extendedInfo.className;

  return {
    cssContent: scopedResult.processedCss,
    extensions,
    finalClassName: mergedClassName,
    scopedVariables: context.state.scopedVariables,
  };
}

export function processGlobalStyle(
  quasi: t.TemplateLiteral,
  context: CssProcessingContext,
  fileHash: string,
  classIndexRef?: { current: number },
): { warnings?: string[] } {
  const { cssContent } = processCssTemplate(
    quasi,
    context,
    undefined,
    'createGlobalStyle',
    false, // Global styles don't need dev mode
  );

  // Initialize file-level scoped variables map if needed
  if (!context.state.scopedVariables) {
    context.state.scopedVariables = new Map();
  }

  // Process scoped CSS variables
  const scopedResult = processScopedCssVariables(
    cssContent,
    fileHash,
    false, // Global styles don't use dev mode
    context.state.scopedVariables,
    classIndexRef,
    context.state.potentiallyUndeclaredScopedVariables,
  );

  // Merge newly found scoped variables into file-level map
  for (const [varName, varInfo] of scopedResult.scopedVariables) {
    if (!context.state.scopedVariables.has(varName)) {
      context.state.scopedVariables.set(varName, varInfo);
    }
  }

  // Clean up CSS content and add to global styles (no class wrapper)
  // Global styles should not be wrapped in layers
  const cleanedCss = cleanCss(scopedResult.processedCss);
  if (cleanedCss.trim()) {
    context.state.cssRules.push(cleanedCss);
    // Clear any layer state since global styles don't use layers
    context.state.currentLayer = undefined;
  }

  return { warnings: scopedResult.warnings };
}

export function processKeyframes(
  quasi: t.TemplateLiteral,
  context: CssProcessingContext,
  variableName: string | undefined,
  dev: boolean,
  fileHash: string,
  classIndex: number,
): CssProcessingResult {
  const { cssContent } = processCssTemplate(
    quasi,
    context,
    variableName,
    'keyframes',
    dev,
  );

  const animationName = generateClassName(
    dev,
    fileHash,
    classIndex,
    variableName,
  );

  if (cssContent.trim() === '') {
    return {
      cssContent,
      extensions: [],
      finalClassName: animationName,
    };
  }

  // Clean up CSS content and wrap in @keyframes rule
  // Keyframes should not be wrapped in layers
  const cleanedCss = cleanCss(cssContent);
  const keyframesRule = `@keyframes ${animationName} {\n  ${cleanedCss}\n}`;

  context.state.cssRules.push(keyframesRule);
  // Clear any layer state since keyframes don't use layers
  context.state.currentLayer = undefined;

  return {
    cssContent,
    extensions: [],
    finalClassName: animationName,
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

function generateClassName(
  dev: boolean,
  fileHash: string,
  classIndex: number,
  varName?: string,
) {
  return dev && varName ?
      `${fileHash}-${classIndex}-${varName}`
    : `${fileHash}-${classIndex}`;
}
