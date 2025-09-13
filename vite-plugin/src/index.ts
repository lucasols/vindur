import { existsSync, readFileSync } from 'node:fs';
import { extname, relative } from 'node:path';
import type { SourceMapInput } from 'rollup';
import {
  transform,
  TransformError,
  type TransformFS,
  type TransformFunctionCache,
  type VindurTransformResult,
} from 'vindur/transform';
import { type Plugin, type ViteDevServer } from 'vite';

export type VindurPluginOptions = {
  debugLogs?: boolean;
  importAliases: Record<string, string>;
  sourcemap?: boolean;
};

const JS_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];
const VIRTUAL_PREFIX = 'virtual:vindur-';

export function vindurPlugin(options: VindurPluginOptions): Plugin {
  const { debugLogs = false, importAliases = {}, sourcemap } = options;

  type CssVirtualModule = { code: string; map: SourceMapInput | null };
  const virtualCssModules = new Map<string, CssVirtualModule>();
  const functionCache: TransformFunctionCache = {};
  // Track which files depend on which external files (for hot-reload)
  const fileDependencies = new Map<string, Set<string>>(); // externalFile -> Set<dependentFile>
  let devServer: ViteDevServer | undefined;

  const fs: TransformFS = {
    readFile: (fileAbsPath: string) => readFileSync(fileAbsPath, 'utf-8'),
    exists: (fileAbsPath: string) => existsSync(fileAbsPath),
  };

  return {
    name: 'vindur',
    enforce: 'pre',
    configureServer(server) {
      devServer = server;
    },

    resolveId(id) {
      // FIX: implement
    },

    load(id) {
      // FIX: implement
    },

    transform(code, id) {
      // eslint-disable-next-line @ls-stack/prefer-named-functions -- we need to access the context
      const log = (message: string) => {
        if (debugLogs) {
          this.info(`[vindur-plugin] ${message}`);
        }
      };

      log(`TRANSFORM CALLED: ${id}`);

      const shouldTransformFile = hasVindurStyles(code, id);

      log(`Transform check for ${id}: shouldTransform=${shouldTransformFile}`);

      if (!shouldTransformFile) return null;

      log(`Processing file: ${id}`);

      let result: VindurTransformResult;

      try {
        result = transform({
          fileAbsPath: id,
          source: code,
          dev: devServer?.config.command === 'serve',
          debug:
            debugLogs ?
              {
                log: (message: string) => console.info(`[vindur] ${message}`),
                warn: (message: string) => console.warn(`[vindur] ${message}`),
              }
            : undefined,
          fs,
          transformFunctionCache: functionCache,
          importAliases,
          sourcemap: sourcemap ?? !!devServer,
        });
      } catch (error) {
        if (error instanceof TransformError) {
          return this.error({
            code: 'VINDUR_TRANSFORM_FAILED',
            id,
            message: error.message,
            loc: error.loc,
          });
        }

        return this.error({
          code: 'VINDUR_TRANSFORM_FAILED',
          id,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      // FIX: implement

      return { code: result.code, map: result.map };
    },

    generateBundle() {
      virtualCssModules.clear();
    },
  };
}

function shouldTransform(id: string): boolean {
  if (id.includes('node_modules')) return false;
  return JS_EXTENSIONS.includes(extname(id));
}

function hasVindurStyles(code: string, id: string): boolean {
  return code.includes('vindur') && shouldTransform(id);
}

const VIRTUAL_CSS_ID_PREFIX_REGEX = /\.[jt]sx?$/;

function getVirtualCssIdPrefix(id: string): string {
  const relativePath = relative(process.cwd(), id);
  return relativePath
    .replace(VIRTUAL_CSS_ID_PREFIX_REGEX, '')
    .replace(/\//g, '_');
}
