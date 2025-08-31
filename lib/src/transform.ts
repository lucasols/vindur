import * as babel from '@babel/core';
import type { RawSourceMap } from 'source-map';
import {
  createVindurPlugin,
  type DebugLogger,
  type DynamicColorCache,
  type FunctionCache,
  type VindurPluginState,
} from './babel-plugin';
import { CssSourceMapGenerator } from './css-source-map';

export type VindurTransformResult = {
  css: string;
  cssMap?: RawSourceMap | null;
  styleDependencies: string[];
  code: string;
  map?: babel.BabelFileResult['map'] | null | undefined;
};

export type TransformFS = { 
  readFile: (fileAbsPath: string) => string;
  exists: (fileAbsPath: string) => boolean;
};

export type TransformFunctionCache = FunctionCache;
export type TransformDynamicColorCache = DynamicColorCache;

export type TransformOptions = {
  fileAbsPath: string;
  source: string;
  dev?: boolean;
  debug?: DebugLogger;
  fs: TransformFS;
  transformFunctionCache?: TransformFunctionCache;
  transformDynamicColorCache?: TransformDynamicColorCache;
  importAliases: Record<string, string>;
  sourcemap?: boolean;
};

export function transform({
  fileAbsPath,
  source,
  dev = false,
  debug,
  fs,
  transformFunctionCache = {},
  transformDynamicColorCache = {},
  importAliases,
  sourcemap = false,
}: TransformOptions): VindurTransformResult {
  const pluginState: VindurPluginState = {
    cssRules: [],
    vindurImports: new Set<string>(),
    styledComponents: new Map(),
    cssVariables: new Map(),
    keyframes: new Map(),
    potentiallyUndeclaredScopedVariables: new Set(),
    elementsWithCssContext: new WeakSet(),
    styleDependencies: new Set<string>(),
  };

  if (!fileAbsPath.includes('/')) {
    throw new Error('fileAbsPath must be an absolute path');
  }

  const plugin = createVindurPlugin(
    {
      filePath: fileAbsPath,
      sourceContent: source,
      dev,
      debug,
      fs,
      transformFunctionCache,
      dynamicColorCache: transformDynamicColorCache,
      importAliases,
    },
    pluginState,
  );

  const result = babel.transformSync(source, {
    plugins: [plugin],
    parserOpts: { 
      sourceType: 'module', 
      plugins: ['typescript', 'jsx'],
      ranges: true, // Enable ranges for better location info
    },
    filename: fileAbsPath,
    sourceMaps: sourcemap,
    compact: false, // Don't compress - helps with location preservation
  });

  if (!result?.code && result?.code !== '') {
    throw new Error('Transform failed');
  }

  let finalCode = result.code;

  // Emit warnings for any remaining potentially undeclared scoped variables
  if (
    dev
    && pluginState.potentiallyUndeclaredScopedVariables
    && pluginState.potentiallyUndeclaredScopedVariables.size > 0
  ) {
    const warnings: string[] = [];
    for (const varName of pluginState.potentiallyUndeclaredScopedVariables) {
      warnings.push(
        `console.warn("Scoped variable '---${varName}' is used but never declared");`,
      );
    }
    if (warnings.length > 0) {
      finalCode = `${warnings.join('\n')}\n${finalCode}`;
    }
  }

  // Generate CSS and source map
  let css = '';
  let cssMap: RawSourceMap | null = null;
  
  if (pluginState.cssRules.length > 0) {
    if (sourcemap) {
      // Generate CSS with source map
      const cssGenerator = new CssSourceMapGenerator(`${fileAbsPath.split('/').pop()}.css`);
      
      for (const cssRule of pluginState.cssRules) {
        // For now, generate source map without location info to test the basic structure
        const basicCssRule = {
          css: cssRule.css,
          location: {
            source: fileAbsPath,
            sourceContent: source,
            start: { line: 0, column: 0 },
            end: { line: 0, column: 0 },
          },
        };
        cssGenerator.addCssRule(basicCssRule);
      }
      
      css = pluginState.cssRules.map(rule => rule.css).join('\n\n');
      cssMap = cssGenerator.toJSON();
    } else {
      // Just concatenate CSS without source maps
      css = pluginState.cssRules.map(rule => rule.css).join('\n\n');
    }
  }

  return {
    css,
    cssMap,
    styleDependencies: [...(pluginState.styleDependencies || [])],
    code: finalCode,
    map: result.map,
  };
}

export { TransformError } from './custom-errors';
