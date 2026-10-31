import type { Rule } from 'eslint';
import { createHash } from 'node:crypto';
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
  /** Modification time of each file the compiler read or linted, to evict it when it changes */
  mtimes: Map<string, number>;
  /** Fingerprint of the last content compiled for each file, editors lint unsaved buffers */
  fingerprints: Map<string, string>;
  /** Files the compiler looked for but didn't find, creating one resets the cache */
  missingFiles: Set<string>;
  lastValidation: number;
};

const sharedCaches = new Map<string, SharedCache>();

// Files are checked for changes at most once per interval, a CLI run lints many files in a row
// and doesn't change them, an editor relints after edits
const REVALIDATE_INTERVAL_MS = 1000;

function fileMtime(fileAbsPath: string): number {
  return statSync(fileAbsPath, { throwIfNoEntry: false })?.mtimeMs ?? -1;
}

function fingerprint(content: string): string {
  return createHash('sha1').update(content).digest('base64');
}

function getSharedCache(importAliases: Record<string, string>): SharedCache {
  const key = JSON.stringify(importAliases);
  const existing = sharedCaches.get(key);
  if (existing) return existing;

  const mtimes = new Map<string, number>();
  const fingerprints = new Map<string, string>();
  const missingFiles = new Set<string>();
  const cache: SharedCache = {
    functions: {},
    fs: {
      readFile: (fileAbsPath: string) => {
        // Read after the stat, so a write in between is seen as a change
        const mtime = fileMtime(fileAbsPath);
        const content = readFileSync(fileAbsPath, 'utf-8');
        mtimes.set(fileAbsPath, mtime);
        fingerprints.set(fileAbsPath, fingerprint(content));
        return content;
      },
      exists: (fileAbsPath: string) => {
        const found = existsSync(fileAbsPath);
        if (!found) missingFiles.add(fileAbsPath);
        return found;
      },
    },
    mtimes,
    fingerprints,
    missingFiles,
    lastValidation: 0,
  };
  sharedCaches.set(key, cache);
  return cache;
}

/** Drops all compiled modules, for changes that can't be traced to the modules they affect */
function resetSharedCache(cache: SharedCache, changedFile: string) {
  // Also clears the module resolution cache, which is shared by all compilers
  invalidateTransformCache(cache.functions, changedFile);
  cache.functions = {};
  cache.mtimes.clear();
  cache.fingerprints.clear();
  cache.missingFiles.clear();
}

/** Evicts the modules whose files changed on disk, and the modules built from them */
function evictChangedFiles(cache: SharedCache) {
  const now = Date.now();
  if (now - cache.lastValidation < REVALIDATE_INTERVAL_MS) return;
  cache.lastValidation = now;

  // A module importing a file that didn't exist doesn't depend on it in the compiler, so its
  // creation can't be traced to the modules to evict
  for (const fileAbsPath of cache.missingFiles) {
    if (existsSync(fileAbsPath)) {
      resetSharedCache(cache, fileAbsPath);
      return;
    }
  }

  for (const [fileAbsPath, mtime] of cache.mtimes) {
    if (fileMtime(fileAbsPath) !== mtime) {
      invalidateTransformCache(cache.functions, fileAbsPath);
      cache.mtimes.delete(fileAbsPath);
      cache.fingerprints.delete(fileAbsPath);
    }
  }
}

/** The linted file's modules are compiled from `source`, which can differ from the last one */
function trackLintedFile(cache: SharedCache, filename: string, source: string) {
  const sourceFingerprint = fingerprint(source);
  const previous = cache.fingerprints.get(filename);
  if (previous !== undefined && previous !== sourceFingerprint) {
    invalidateTransformCache(cache.functions, filename);
  }
  cache.fingerprints.set(filename, sourceFingerprint);
  cache.mtimes.set(filename, fileMtime(filename));
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
  evictChangedFiles(cache);
  trackLintedFile(cache, filename, source);

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
