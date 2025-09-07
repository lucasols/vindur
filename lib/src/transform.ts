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
import { TransformWarning } from './custom-errors';

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
  onWarning?: (warning: TransformWarning) => void;
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
  onWarning,
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
      onWarning,
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

  const finalCode = result.code;

  // Emit warnings for any remaining potentially undeclared scoped variables
  if (
    dev
    && pluginState.potentiallyUndeclaredScopedVariables
    && pluginState.potentiallyUndeclaredScopedVariables.size > 0
    && onWarning
  ) {
    for (const varName of pluginState.potentiallyUndeclaredScopedVariables) {
      const warning = new TransformWarning(
        `Scoped variable '---${varName}' is used but never declared`,
        {
          start: { line: 1, column: 0, index: 0 },
          end: { line: 1, column: 0, index: 0 },
          filename: fileAbsPath,
          identifierName: undefined,
        },
        { filename: fileAbsPath },
      );
      onWarning(warning);
    }
  }

  // Generate CSS and source map
  let css = '';
  let cssMap: RawSourceMap | null = null;

  if (pluginState.cssRules.length > 0) {
    if (sourcemap) {
      // Generate CSS with source map
      const cssGenerator = new CssSourceMapGenerator(
        `${fileAbsPath.split('/').pop()}.css`,
      );

      for (const cssRule of pluginState.cssRules) {
        cssGenerator.addCssRule(cssRule);
      }

      css = pluginState.cssRules.map((rule) => rule.css).join('\n\n');
      cssMap = cssGenerator.toJSON();
    } else {
      // Just concatenate CSS without source maps
      css = pluginState.cssRules.map((rule) => rule.css).join('\n\n');
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

export { TransformError, TransformWarning } from './custom-errors';
