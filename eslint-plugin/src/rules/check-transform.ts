import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { transform, TransformError, type TransformFS } from 'vindur/transform';
import type { Rule } from 'eslint';
import type { VindurPluginOptions } from '../types';

type RuleOptions = VindurPluginOptions;

type CacheEntry = {
  source: string;
  result: { errors: Array<{ message: string; line: number; column: number; type: 'error' | 'warning' }>; css: string };
  timestamp: number;
};

const transformCache = new Map<string, CacheEntry>();
const JS_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];
const CACHE_TTL = 5000; // 5 seconds
const CONSOLE_WARN_REGEX = /console\.warn\((.+)\)/;

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

function extractWarningsFromTransformResult(transformedCode: string): Array<{ message: string; line: number }> {
  const warnings: Array<{ message: string; line: number }> = [];
  const lines = transformedCode.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const consoleWarnMatch = line.match(CONSOLE_WARN_REGEX);
    
    if (consoleWarnMatch) {
      try {
        // Extract the warning message from the console.warn call
        const messageContent = consoleWarnMatch[1];
        if (!messageContent) continue;
        // Remove quotes and extract the actual warning message
        const cleanMessage = messageContent.replace(/^["']|["']$/g, '');
        
        warnings.push({
          message: cleanMessage,
          line: i + 1
        });
      } catch {
        // Ignore parsing errors for warning extraction
      }
    }
  }
  
  return warnings;
}

function runVindurTransform(filename: string, source: string, options: RuleOptions) {
  const now = Date.now();
  const cached = transformCache.get(filename);
  
  // Check cache validity
  if (cached && cached.source === source && (now - cached.timestamp) < CACHE_TTL) {
    return cached.result;
  }

  const fs: TransformFS = {
    readFile: (fileAbsPath: string) => readFileSync(fileAbsPath, 'utf-8'),
    exists: (fileAbsPath: string) => existsSync(fileAbsPath),
  };

  const errors: Array<{ message: string; line: number; column: number; type: 'error' | 'warning' }> = [];
  let transformedCode = '';
  let css = '';

  try {
    const result = transform({
      fileAbsPath: filename,
      source,
      dev: options.dev ?? true,
      fs,
      importAliases: options.importAliases ?? {},
      sourcemap: false, // We don't need sourcemaps for ESLint
    });
    
    transformedCode = result.code;
    css = result.css;
    
    // Extract warnings from transformed code
    if (options.reportWarnings !== false) {
      const warnings = extractWarningsFromTransformResult(transformedCode);
      for (const warning of warnings) {
        errors.push({
          message: warning.message,
          line: warning.line,
          column: 1,
          type: 'warning'
        });
      }
    }
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

  const result = { errors, css };
  
  // Update cache
  transformCache.set(filename, {
    source,
    result,
    timestamp: now
  });

  return result;
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
    const filename = context.filename && context.filename.startsWith('/') ? context.filename : '/test.ts';
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