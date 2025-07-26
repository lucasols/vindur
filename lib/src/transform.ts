import * as babel from '@babel/core';
import {
  createVindurPlugin,
  type DebugLogger,
  type FunctionCache,
  type VindurPluginState,
} from './babel-plugin';

type Result = { css: string; styleDependencies: string[]; code: string };

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
};

export function transform({
  fileAbsPath,
  source,
  dev = false,
  debug,
  fs,
  transformFunctionCache = {},
  importAliases,
}: TransformOptions): Result {
  const pluginState: VindurPluginState = {
    cssRules: [],
    vindurImports: new Set<string>(),
    styledComponents: new Map(),
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
  });

  if (!result?.code) {
    throw new Error('Transform failed');
  }

  return {
    css: pluginState.cssRules.join('\n\n'),
    styleDependencies: [],
    code: result.code,
  };
}
