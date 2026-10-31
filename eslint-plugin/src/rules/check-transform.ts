import type { Rule } from 'eslint';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import {
  invalidateTransformCache,
  mayContainVindurCode,
  transform,
  TransformError,
  TransformWarning,
  type TransformFS,
  type TransformFunctionCache,
  type TransformOptions,
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

// Shared by the files of a lint run, so modules imported by many files, like theme colors or
// vindurFn mixins, are compiled once. Keyed by the import aliases, which change how imports
// resolve
type SharedCache = {
  functions: TransformFunctionCache;
  createdAt: number;
  lastCall: number;
};

const sharedCaches = new Map<string, SharedCache>();

// A CLI run (CI, AI agents) lints files back to back, so the cache is reused with no tracking
// cost on each file. Long-lived processes, like editor ESLint servers, compile again after a
// pause between lint calls, and at least every few seconds while calls keep coming, to pick up
// changed, created or deleted files
const RESET_AFTER_PAUSE_MS = 1000;
const RESET_AFTER_AGE_MS = 30_000;

function getSharedCache(importAliases: Record<string, string>): SharedCache {
  const key = JSON.stringify(importAliases);
  const now = Date.now();
  const existing = sharedCaches.get(key);
  if (
    existing
    && now - existing.lastCall < RESET_AFTER_PAUSE_MS
    && now - existing.createdAt < RESET_AFTER_AGE_MS
  ) {
    existing.lastCall = now;
    return existing;
  }

  if (existing) resetCompiledModules(existing);
  const cache: SharedCache = { functions: {}, createdAt: now, lastCall: now };
  sharedCaches.set(key, cache);
  return cache;
}

/** Also clears the native module resolution cache, which all compilers share */
function resetCompiledModules(cache: SharedCache) {
  invalidateTransformCache(cache.functions, '');
}

/** For tests, which lint different contents under the same paths */
export function clearTransformCaches(): void {
  for (const cache of sharedCaches.values()) resetCompiledModules(cache);
  sharedCaches.clear();
}

const fs: TransformFS = {
  readFile: (fileAbsPath: string) => readFileSync(fileAbsPath, 'utf-8'),
  exists: (fileAbsPath: string) => existsSync(fileAbsPath),
};

function runVindurTransform(
  filename: string,
  source: string,
  importAliases: Record<string, string>,
  colorSchemeClassNames: TransformOptions['colorSchemeClassNames'],
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

  // The function cache doesn't depend on `colorSchemeClassNames`, only the output of the
  // linted file does, so the cache is keyed by the import aliases alone
  const cache = getSharedCache(importAliases);

  try {
    transform({
      fileAbsPath: filename,
      source,
      dev: true, // Always run in dev mode
      fs,
      importAliases,
      colorSchemeClassNames,
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
          colorSchemeClassNames: {
            type: 'object',
            properties: {
              light: { type: 'string' },
              dark: { type: 'string' },
            },
            required: ['light', 'dark'],
            additionalProperties: false,
            description:
              'The colorSchemeClassNames option of the vite plugin, so their classes are not reported as undeclared',
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
        const result = runVindurTransform(
          filename,
          source,
          importAliases,
          options.colorSchemeClassNames,
        );

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
