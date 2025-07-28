import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import {
  transform,
  type TransformFS,
  type TransformFunctionCache,
  type VindurTransformResult,
} from 'vindur/transform';
import { type Plugin, type ViteDevServer } from 'vite';

export type VindurPluginOptions = {
  debugLogs?: boolean;
  importAliases: Record<string, string>;
};

const JS_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];

function shouldTransform(id: string): boolean {
  if (id.includes('node_modules')) return false;
  return JS_EXTENSIONS.includes(extname(id));
}

export function vindurPlugin(options: VindurPluginOptions): Plugin {
  const { debugLogs = false, importAliases = {} } = options;

  const virtualCssModules = new Map<string, string>();
  const functionCache: TransformFunctionCache = {};
  let server: ViteDevServer | undefined;

  const fs: TransformFS = {
    readFile: (fileAbsPath: string) => readFileSync(fileAbsPath, 'utf-8'),
  };

  const debug =
    debugLogs ?
      {
        log: (message: string) => console.info(`[vindur] ${message}`),
        warn: (message: string) => console.warn(`[vindur] ${message}`),
      }
    : undefined;

  return {
    name: 'vindur',
    enforce: 'pre' as const,
    configureServer(devServer) {
      server = devServer;
    },

    resolveId(id) {
      if (virtualCssModules.has(id)) {
        if (debugLogs) {
          this.info(`[vindur-plugin] Resolving virtual CSS module: ${id}`);
        }
        return id;
      }
      return null;
    },

    load(id) {
      if (virtualCssModules.has(id)) {
        if (debugLogs) {
          this.info(`[vindur-plugin] Loading virtual CSS module: ${id}`);
        }
        return virtualCssModules.get(id);
      }
      return null;
    },

    transform(code, id) {
      // eslint-disable-next-line @ls-stack/prefer-named-functions -- we need to access the context
      const log = (message: string) => {
        if (debugLogs) {
          this.info(`[vindur-plugin] ${message}`);
        }
      };

      log(`TRANSFORM CALLED: ${id}`);

      const shouldTransformFile = shouldTransform(id);
      const containsVindur = code.includes('vindur');

      log(
        `Transform check for ${id}: shouldTransform=${shouldTransformFile}, containsVindur=${containsVindur}`,
      );

      if (!shouldTransformFile || !containsVindur) {
        return null;
      }

      log(`Processing file: ${id}`);
      log(`Starting transform for: ${id}`);

      let result: VindurTransformResult;

      try {
        result = transform({
          fileAbsPath: id,
          source: code,
          dev: server?.config.command === 'serve',
          debug,
          fs,
          transformFunctionCache: functionCache,
          importAliases,
        });
      } catch (error) {
        return this.error({
          code: 'VINDUR_TRANSFORM_FAILED',
          id,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      log(
        `Transform completed for: ${id}, hasCSS: ${!!result.css}, codeLength: ${result.code.length}`,
      );

      if (result.css) {
        log(`Generated CSS for ${id}: ${result.css.slice(0, 100)}...`);

        // Generate virtual CSS module ID using file path + content hash for hot reload
        const fileHash = createHash('md5').update(id).digest('hex').slice(0, 8);
        const contentHash = createHash('md5')
          .update(result.css)
          .digest('hex')
          .slice(0, 8);
        const virtualCssId = `virtual:vindur-${fileHash}-${contentHash}.css`;

        // Store CSS content in virtual module cache
        virtualCssModules.set(virtualCssId, result.css);
        log(`Stored virtual CSS module: ${virtualCssId}`);

        // Add CSS import to the transformed code
        const cssImport = `import '${virtualCssId}';`;
        log(`Returning transformed code with CSS import for: ${id}`);
        return {
          code: `${cssImport}\n${result.code}`,
          map: null,
        };
      }

      log(`Returning transformed code without CSS for: ${id}`);
      return { code: result.code, map: null };
    },

    generateBundle() {
      virtualCssModules.clear();
    },

    handleHotUpdate({ file }) {
      // Find and remove virtual CSS modules for this file
      const fileHash = createHash('md5').update(file).digest('hex').slice(0, 8);
      const virtualCssPrefix = `virtual:vindur-${fileHash}-`;

      // Remove all virtual CSS modules that match this file
      for (const [virtualCssId] of virtualCssModules) {
        if (virtualCssId.startsWith(virtualCssPrefix)) {
          virtualCssModules.delete(virtualCssId);
          if (debugLogs) {
            this.info(
              `[vindur-plugin] Cleared virtual CSS module for hot update: ${virtualCssId}`,
            );
          }
        }
      }

      // Clear function cache for this file to ensure vindurFn changes are picked up
      if (functionCache[file]) {
        delete functionCache[file];
        if (debugLogs) {
          this.info(
            `[vindur-plugin] Cleared function cache for hot update: ${file}`,
          );
        }
      }

      return undefined;
    },
  };
}
