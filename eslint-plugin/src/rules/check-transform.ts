import type { Rule } from 'eslint';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import {
  mayContainVindurCode,
  transform,
  TransformError,
  TransformWarning,
  type TransformDynamicColorCache,
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

type TransformCaches = {
  functions: TransformFunctionCache;
  dynamicColors: TransformDynamicColorCache;
};

// Shared by all files of a lint run, so modules imported by many files, like theme colors or
// vindurFn mixins, are compiled once. Lint runs from the CLI, the files don't change during it.
// Keyed by the import aliases, which change how imports resolve
const transformCaches = new Map<string, TransformCaches>();

function getTransformCaches(importAliases: Record<string, string>) {
  const key = JSON.stringify(importAliases);
  let caches = transformCaches.get(key);
  if (!caches) {
    caches = { functions: {}, dynamicColors: {} };
    transformCaches.set(key, caches);
  }
  return caches;
}

/** For tests, which lint different contents under the same paths */
export function clearTransformCaches(): void {
  transformCaches.clear();
}

const fs: TransformFS = {
  readFile: (fileAbsPath: string) => readFileSync(fileAbsPath, 'utf-8'),
  exists: (fileAbsPath: string) => existsSync(fileAbsPath),
};

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

  const caches = getTransformCaches(importAliases);

  try {
    transform({
      fileAbsPath: filename,
      source,
      dev: true, // Always run in dev mode
      fs,
      importAliases,
      sourcemap: false, // We don't need sourcemaps for ESLint
      onWarning,
      transformDynamicColorCache: caches.dynamicColors,
      transformFunctionCache: caches.functions,
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
