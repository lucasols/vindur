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
  /** `false` when the file has no vindur code to compile, like a native SVG `cx` attribute */
  changed: boolean;
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

// Patterns of code the compiler handles, files matching none of them have no vindur code,
// so tools can skip them without parsing. Kept loose: a match only means the file may have it
export const VINDUR_CODE_PATTERNS: readonly RegExp[] = [
  // The module literal alone, so comments between it and `from` or `import` don't matter
  /['"]vindur['"]/u,
  // `dynamicColor` only counts with an expression value, the compiler validates it, so a
  // string value of an unrelated custom prop is left alone
  /\b(?:css|cx)\s*=|\bdynamicColor\s*=\s*\{/u,
  // Scoped variable keys and reads of a `style` prop, like `'---color'`, `'---' + name`,
  // `` `---${name}` `` or `'var(---color)'` (CSS functions are case insensitive and allow
  // spaces, like `VAR( ---color)`), which are renamed or rejected
  /['"`]---|var\(\s*---/iu,
];

export function mayContainVindurCode(code: string): boolean {
  return VINDUR_CODE_PATTERNS.some((pattern) => pattern.test(code));
}

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
