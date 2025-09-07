import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { transform, TransformError, TransformWarning, type TransformFS } from 'vindur/transform';
import type { Rule } from 'eslint';
import type { VindurPluginOptions } from '../types';

type RuleOptions = VindurPluginOptions;

const JS_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];
function shouldProcessFile(filename: string, source: string): boolean {
  if (!JS_EXTENSIONS.includes(extname(filename))) {
    return false;
  }
  
  if (filename.includes('node_modules')) return false;
  
  // Only process files that contain vindur imports or usage
  return source.includes('vindur') || 
         source.includes('css`') || 
         source.includes('styled.') ||
         source.includes('cx=') ||
         source.includes('css=');
}

function runVindurTransform(filename: string, source: string, options: RuleOptions) {
  const fs: TransformFS = {
    readFile: (fileAbsPath: string) => readFileSync(fileAbsPath, 'utf-8'),
    exists: (fileAbsPath: string) => existsSync(fileAbsPath),
  };

  const errors: Array<{ message: string; line: number; column: number; type: 'error' | 'warning' }> = [];

  // Collect warnings via callback
  const onWarning = options.reportWarnings !== false ? (warning: TransformWarning) => {
    errors.push({
      message: warning.message,
      line: warning.loc.line,
      column: warning.loc.column,
      type: 'warning'
    });
  } : undefined;

  try {
    transform({
      fileAbsPath: filename,
      source,
      dev: options.dev ?? true,
      fs,
      importAliases: options.importAliases ?? {},
      sourcemap: false, // We don't need sourcemaps for ESLint
      onWarning,
    });
  } catch (error) {
    if (error instanceof TransformError) {
      errors.push({
        message: error.message,
        line: error.loc?.line ?? 1,
        column: error.loc?.column ?? 0,
        type: 'error'
      });
    } else {
      errors.push({
        message: error instanceof Error ? error.message : String(error),
        line: 1,
        column: 0,
        type: 'error'
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
              type: 'string'
            }
          },
          dev: {
            type: 'boolean'
          },
          reportWarnings: {
            type: 'boolean'
          }
        },
        additionalProperties: false
      }
    ],
    messages: {
      transformError: '{{message}}',
      transformWarning: '{{message}}'
    }
  },

  create(context) {
    const filename = context.filename.startsWith('/') ? context.filename : '/test.ts';
    const source = context.sourceCode.getText();
    const rawOptions = context.options[0];
    
    const options: RuleOptions = {
      importAliases: {},
      dev: true,
      reportWarnings: true,
    };
    
    if (rawOptions && typeof rawOptions === 'object') {
      if ('importAliases' in rawOptions && typeof rawOptions.importAliases === 'object' && rawOptions.importAliases) {
        options.importAliases = rawOptions.importAliases as Record<string, string>;
      }
      if ('dev' in rawOptions && typeof rawOptions.dev === 'boolean') {
        options.dev = rawOptions.dev;
      }
      if ('reportWarnings' in rawOptions && typeof rawOptions.reportWarnings === 'boolean') {
        options.reportWarnings = rawOptions.reportWarnings;
      }
    }

    // Only process relevant files
    if (!shouldProcessFile(filename, source)) return {};

    return {
      Program(node) {
        const result = runVindurTransform(filename, source, options);
        
        for (const error of result.errors) {
          context.report({
            node,
            messageId: error.type === 'error' ? 'transformError' : 'transformWarning',
            data: { message: error.message },
            loc: {
              line: error.line,
              column: error.column
            }
          });
        }
      }
    };
  }
};