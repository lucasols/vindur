import * as babel from '@babel/core';
import { createVindurPlugin, type VindurPluginState } from './babel-plugin';

type Result = { css: string; styleDependencies: string[]; code: string };

export type TransformFS = { readFile: (fileAbsPath: string) => string };

export type TransformOptions = {
  fileAbsPath: string;
  source: string;
  dev?: boolean;
  fs: TransformFS;
};

export function transform({
  fileAbsPath: filePath,
  source,
  dev = false,
  fs,
}: TransformOptions): Result {
  const pluginState: VindurPluginState = {
    cssRules: [],
    vindurImports: new Set<string>(),
    compiledFunctions: {},
  };

  const plugin = createVindurPlugin({ filePath, dev, fs }, pluginState);

  const result = babel.transformSync(source, {
    plugins: [plugin],
    parserOpts: { sourceType: 'module', plugins: ['typescript', 'jsx'] },
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
