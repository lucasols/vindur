import type { Rule } from 'eslint';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import {
  invalidateTransformCache,
  mayContainVindurCode,
  transform,
  TransformError,
  TransformWarning,
  type TransformFS,
  type TransformFunctionCache,
} from 'vindur/transform';

const JS_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];
const FILENAME_REGEX = /^\/[^:]+:\s*/;

function stripFilenameFromMessage(message: string): string {
  // Remove filename prefix like "/path/to/file.tsx: " from the beginning of error messages
  // ESLint already provides filename context, so this is redundant
  return message.replace(FILENAME_REGEX, '');
}
function shouldProcessFile(filename: string, source: string): boolean {
  if (!JS_EXTENSIONS.includes(extname(filename))) {
    return false;
  }

  if (filename.includes('node_modules')) return false;

  return mayContainVindurCode(source);
}

// Shared by all files linted by the process, so modules imported by many files, like theme
// colors or vindurFn mixins, are compiled once. Keyed by the import aliases, which change how
// imports resolve
type SharedCache = {
  functions: TransformFunctionCache;
  fs: TransformFS;
  /** Modification time of each file the compiler read, to evict it when it changes */
  readFileMtimes: Map<string, number>;
  /** Last source linted for each file, editors lint unsaved buffers */
  lintedSources: Map<string, string>;
  lastCallEnd: number;
};

const sharedCaches = new Map<string, SharedCache>();

// A CLI run lints file after file and the files don't change during it, so only a call after
// a pause, like an editor relinting after an edit, checks for changed files
const REVALIDATE_AFTER_IDLE_MS = 1000;

function fileMtime(fileAbsPath: string): number {
  return statSync(fileAbsPath, { throwIfNoEntry: false })?.mtimeMs ?? -1;
}

function getSharedCache(importAliases: Record<string, string>): SharedCache {
  const key = JSON.stringify(importAliases);
  let cache = sharedCaches.get(key);
  if (!cache) {
    const readFileMtimes = new Map<string, number>();
    cache = {
      functions: {},
      fs: {
        readFile: (fileAbsPath: string) => {
          const content = readFileSync(fileAbsPath, 'utf-8');
          readFileMtimes.set(fileAbsPath, fileMtime(fileAbsPath));
          return content;
        },
        exists: (fileAbsPath: string) => existsSync(fileAbsPath),
      },
      readFileMtimes,
      lintedSources: new Map(),
      lastCallEnd: 0,
    };
    sharedCaches.set(key, cache);
  }
  return cache;
}

/** Evicts the files that changed since the compiler read them, and their dependents */
function invalidateChangedFiles(
  cache: SharedCache,
  filename: string,
  source: string,
) {
  if (Date.now() - cache.lastCallEnd > REVALIDATE_AFTER_IDLE_MS) {
    for (const [fileAbsPath, mtime] of cache.readFileMtimes) {
      if (fileMtime(fileAbsPath) !== mtime) {
        invalidateTransformCache(cache.functions, fileAbsPath);
        cache.readFileMtimes.delete(fileAbsPath);
      }
    }
  }

  const lintedSource = cache.lintedSources.get(filename);
  if (lintedSource !== undefined && lintedSource !== source) {
    invalidateTransformCache(cache.functions, filename);
  }
  cache.lintedSources.set(filename, source);
}

/** For tests, which lint different contents under the same paths */
export function clearTransformCaches(): void {
  sharedCaches.clear();
}

function runVindurTransform(
  filename: string,
  source: string,
  importAliases: Record<string, string> = {},
) {
  const errors: Array<{
    message: string;
    line: number;
    column: number;
    type: 'error' | 'warning';
  }> = [];

  // Always collect warnings - plugin runs in dev mode with warnings enabled
  function onWarning(warning: TransformWarning) {
    if (warning.ignoreInLint) return;

    errors.push({
      message: stripFilenameFromMessage(warning.message),
      line: warning.loc.line,
      column: warning.loc.column,
      type: 'warning',
    });
  }

  const cache = getSharedCache(importAliases);
  invalidateChangedFiles(cache, filename, source);

  try {
    transform({
      fileAbsPath: filename,
      source,
      dev: true, // Always run in dev mode
      fs: cache.fs,
      importAliases,
      sourcemap: false, // We don't need sourcemaps for ESLint
      onWarning,
      transformDynamicColorCache: {},
      transformFunctionCache: cache.functions,
    });
  } catch (error) {
    if (error instanceof TransformError) {
      if (!error.ignoreInLint) {
        // Errors located in an imported file are reported at the start of the linted
        // file, the imported file reports them at the right location when linted
        const isImportedFileError =
          error.loc.filename !== undefined && error.loc.filename !== filename;
        // TransformError must always include a valid location in this codebase
        // The ESLint rule environment enforces fail-fast with proper locations
        errors.push({
          message: stripFilenameFromMessage(error.message),
          line: isImportedFileError ? 1 : error.loc.line,
          column: isImportedFileError ? 0 : error.loc.column,
          type: 'error',
        });
      }
    } else {
      // skip non-transform errors
    }
  }

  cache.lastCallEnd = Date.now();
  return { errors };
}

export const checkTransformRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Detect Vindur transform errors and warnings',
      category: 'Possible Errors',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          importAliases: {
            type: 'object',
            additionalProperties: {
              type: 'string',
            },
            description: 'Import path aliases for resolving module imports',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      transformError: '{{message}}',
      transformWarning: '{{message}}',
    },
  },

  create(context) {
    const filename =
      context.filename.startsWith('/') ? context.filename : '/test.ts';
    const source = context.sourceCode.getText();
    const options = context.options[0] || {};
    const importAliases = options.importAliases || {};

    // Only process relevant files
    if (!shouldProcessFile(filename, source)) return {};

    return {
      Program(node) {
        const result = runVindurTransform(filename, source, importAliases);

        for (const error of result.errors) {
          context.report({
            node,
            messageId:
              error.type === 'error' ? 'transformError' : 'transformWarning',
            data: { message: error.message },
            loc: {
              line: error.line,
              column: error.column,
            },
          });
        }
      },
    };
  },
};
