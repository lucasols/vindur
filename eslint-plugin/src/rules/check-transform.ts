import type { Rule } from 'eslint';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import {
  transform,
  TransformError,
  TransformWarning,
  type TransformFS,
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

  // Only process files that contain vindur imports or usage
  return (
    source.includes('vindur')
    || source.includes('css`')
    || source.includes('styled.')
    || source.includes('cx=')
    || source.includes('css=')
  );
}

function runVindurTransform(
  filename: string,
  source: string,
  importAliases: Record<string, string> = {},
) {
  const fs: TransformFS = {
    readFile: (fileAbsPath: string) => readFileSync(fileAbsPath, 'utf-8'),
    exists: (fileAbsPath: string) => existsSync(fileAbsPath),
  };

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

  try {
    transform({
      fileAbsPath: filename,
      source,
      dev: true, // Always run in dev mode
      fs,
      importAliases,
      sourcemap: false, // We don't need sourcemaps for ESLint
      onWarning,
    });
  } catch (error) {
    if (error instanceof TransformError) {
      if (!error.ignoreInLint) {
        // TransformError must always include a valid location in this codebase
        // The ESLint rule environment enforces fail-fast with proper locations
        errors.push({
          message: stripFilenameFromMessage(error.message),
          line: error.loc.line,
          column: error.loc.column,
          type: 'error',
        });
      }
    } else {
      errors.push({
        message: stripFilenameFromMessage(
          error instanceof Error ? error.message : String(error),
        ),
        line: 1,
        column: 0,
        type: 'error',
      });
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
