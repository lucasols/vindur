import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
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

export function vindurPlugin(options: VindurPluginOptions): Plugin {
  const { debugLogs = false, importAliases = {}, sourcemap } = options;

  const virtualCssModules = new Map<string, string>();
  const functionCache: TransformFunctionCache = {};
  let devServer: ViteDevServer | undefined;

  const fs: TransformFS = {
    readFile: (fileAbsPath: string) => readFileSync(fileAbsPath, 'utf-8'),
  };

  return {
    name: 'vindur',
    enforce: 'pre',
    configureServer(server) {
      devServer = server;
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

      log(
        `Transform completed for: ${id}, hasCSS: ${!!result.css}, codeLength: ${result.code.length}`,
      );

      if (result.css) {
        log(`Generated CSS for ${id}: ${result.css.slice(0, 100)}...`);

        const virtualCssId = `virtual:vindur-${getVirtualCssIdPrefix(id)}.css`;

        // Store CSS content in virtual module cache
        virtualCssModules.set(virtualCssId, result.css);
        log(`Stored virtual CSS module: ${virtualCssId}`);

        // Add CSS import to the transformed code
        const cssImport = `import '${virtualCssId}';`;
        log(`Returning transformed code with CSS import for: ${id}`);

        // Reload the module to apply the new CSS
        if (devServer?.moduleGraph) {
          const module = devServer.moduleGraph.getModuleById(virtualCssId);

          if (module) {
            log(`Reloading module: ${virtualCssId}`);
            devServer.reloadModule(module);
          }
        }

        return {
          code: `${result.code}\n${cssImport}`,
          map: result.map,
        };
      }

      log(`Returning transformed code without CSS for: ${id}`);
      return { code: result.code, map: result.map };
    },

    generateBundle() {
      virtualCssModules.clear();
    },

    handleHotUpdate({ file, modules }) {
      // Find and remove virtual CSS modules for this file
      const virtualCssPrefix = `virtual:vindur-${getVirtualCssIdPrefix(file)}`;

      const modulesToInvalidate = [...modules];

      let hasRelatedVirtualCss = false;

      // Remove all virtual CSS modules that match this file
      for (const [virtualCssId] of virtualCssModules) {
        if (virtualCssId === virtualCssPrefix) {
          virtualCssModules.delete(virtualCssId);
          const cssModule = devServer?.moduleGraph.getModuleById(virtualCssId);
          if (cssModule) {
            modulesToInvalidate.push(cssModule);
            hasRelatedVirtualCss = true;
          }
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

      return hasRelatedVirtualCss ? modulesToInvalidate : undefined;
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
  return id.replace(VIRTUAL_CSS_ID_PREFIX_REGEX, '').replace(/\//g, '_');
}
