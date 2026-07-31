import type { RawSourceMap } from 'source-map';
import type { CompiledFunction } from './types';
import { TransformWarning } from './custom-errors';
import {
  invalidateRustTransformCache,
  transformWithRust,
} from './rust-transform';

export type DebugLogger = {
  log: (message: string) => void;
  warn?: (message: string) => void;
};

export type VindurTransformResult = {
  css: string;
  cssMap?: RawSourceMap | null;
  styleDependencies: string[];
  code: string;
  map?: RawSourceMap | null;
};

export type TransformFS = {
  readFile: (fileAbsPath: string) => string;
  exists: (fileAbsPath: string) => boolean;
};

export type TransformFunctionCache = Record<
  string,
  Record<string, CompiledFunction>
>;
export type TransformDynamicColorCache = Record<string, Record<string, string>>;

export type TransformOptions = {
  fileAbsPath: string;
  source: string;
  dev?: boolean;
  debug?: DebugLogger;
  fs: TransformFS;
  transformFunctionCache: TransformFunctionCache;
  transformDynamicColorCache: TransformDynamicColorCache;
  importAliases: Record<string, string>;
  sourcemap?: boolean;
  onWarning?: (warning: TransformWarning) => void;
};

export function transform(options: TransformOptions): VindurTransformResult {
  return transformWithRust(options);
}

export function invalidateTransformCache(
  transformFunctionCache: TransformFunctionCache,
  filePath: string,
): void {
  delete transformFunctionCache[filePath];
  invalidateRustTransformCache(transformFunctionCache, filePath);
}

export { TransformError, TransformWarning } from './custom-errors';
