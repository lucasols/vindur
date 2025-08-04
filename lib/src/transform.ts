import * as babel from '@babel/core';
import {
  createVindurPlugin,
  type DebugLogger,
  type FunctionCache,
  type VindurPluginState,
} from './babel-plugin';

export type VindurTransformResult = {
  css: string;
  styleDependencies: string[];
  code: string;
  map?: babel.BabelFileResult['map'] | null | undefined;
};

export type TransformFS = { readFile: (fileAbsPath: string) => string };

export type TransformFunctionCache = FunctionCache;

export type TransformOptions = {
  fileAbsPath: string;
  source: string;
  dev?: boolean;
  debug?: DebugLogger;
  fs: TransformFS;
  transformFunctionCache?: TransformFunctionCache;
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
  };

  if (!fileAbsPath.includes('/')) {
    throw new Error('fileAbsPath must be an absolute path');
  }

  const plugin = createVindurPlugin(
    {
      filePath: fileAbsPath,
      dev,
      debug,
      fs,
      transformFunctionCache,
      importAliases,
    },
    pluginState,
  );

  const result = babel.transformSync(source, {
    plugins: [plugin],
    parserOpts: { sourceType: 'module', plugins: ['typescript', 'jsx'] },
    filename: fileAbsPath,
    sourceMaps: sourcemap,
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

  return {
    css: pluginState.cssRules.join('\n\n'),
    styleDependencies: [],
    code: finalCode,
    map: result.map,
  };
}

export { TransformError } from './custom-errors';
