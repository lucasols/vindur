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

  state.cssRules.push(`.${className} {\n  ${cleanedCss}\n}`);
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
): CssProcessingResult {
  const { cssContent, extensions } = processCssTemplate(
    quasi,
    context,
    variableName,
    tagType,
    dev,
  );

  const className = generateClassName(dev, fileHash, classIndex, variableName);
  const finalClassName = generateCssRule(
    className,
    cssContent,
    extensions,
    context.state,
  );

  return { cssContent, extensions, finalClassName };
}

export function processStyledExtension(
  quasi: t.TemplateLiteral,
  context: CssProcessingContext,
  variableName: string,
  extendedName: string,
  dev: boolean,
  fileHash: string,
  classIndex: number,
): CssProcessingResult {
  const { cssContent, extensions } = processCssTemplate(
    quasi,
    context,
    variableName,
    `${STYLED_TAG_NAME}(${extendedName})`,
    dev,
  );

  const className = generateClassName(dev, fileHash, classIndex, variableName);

  // Check if extending a styled component
  const extendedInfo = context.state.styledComponents.get(extendedName);
  if (!extendedInfo) {
    throw new Error(
      `Cannot extend "${extendedName}": it is not a styled component. Only styled components can be extended.`,
    );
  }

  // Clean up CSS content and store the CSS rule
  const cleanedCss = cleanCss(cssContent);
  if (cleanedCss.trim()) {
    context.state.cssRules.push(`.${className} {\n  ${cleanedCss}\n}`);
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
    cssContent,
    extensions,
    finalClassName: mergedClassName,
  };
}

export function processGlobalStyle(
  quasi: t.TemplateLiteral,
  context: CssProcessingContext,
): void {
  const { cssContent } = processCssTemplate(
    quasi,
    context,
    undefined,
    'createGlobalStyle',
    false, // Global styles don't need dev mode
  );

  // Clean up CSS content and add to global styles (no class wrapper)
  const cleanedCss = cleanCss(cssContent);
  if (cleanedCss.trim()) {
    context.state.cssRules.push(cleanedCss);
  }
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
  const cleanedCss = cleanCss(cssContent);
  const keyframesRule = `@keyframes ${animationName} {\n  ${cleanedCss}\n}`;

  context.state.cssRules.push(keyframesRule);

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
