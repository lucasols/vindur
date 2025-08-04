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
  // Track which files depend on which external files (for hot-reload)
  const fileDependencies = new Map<string, Set<string>>(); // externalFile -> Set<dependentFile>
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
        `Transform completed for: ${id}, hasCSS: ${!!result.css}, codeLength: ${result.code.length}, dependencies: ${result.styleDependencies.length}`,
      );

      // Track dependencies for hot-reload
      for (const dependency of result.styleDependencies) {
        if (!fileDependencies.has(dependency)) {
          fileDependencies.set(dependency, new Set());
        }
        const dependentFiles = fileDependencies.get(dependency);
        if (dependentFiles) {
          dependentFiles.add(id);
        }
        log(`Tracked dependency: ${dependency} -> ${id}`);
      }

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
      const virtualCssId = `virtual:vindur-${getVirtualCssIdPrefix(file)}.css`;

      const modulesToInvalidate = [...modules];

      let hasRelatedVirtualCss = false;

      // Remove virtual CSS module that matches this file
      if (virtualCssModules.has(virtualCssId)) {
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

      // Clear function cache for this file to ensure vindurFn changes are picked up
      if (functionCache[file]) {
        delete functionCache[file];
        if (debugLogs) {
          this.info(
            `[vindur-plugin] Cleared function cache for hot update: ${file}`,
          );
        }
      }

      // Find all modules that depend on this file using our own dependency tracking
      // This is crucial for vindurFn and theme color hot-reload
      const dependentFiles = fileDependencies.get(file);

      if (dependentFiles && devServer?.moduleGraph) {
        const moduleGraph = devServer.moduleGraph;

        for (const dependentFile of dependentFiles) {
          if (shouldTransform(dependentFile)) {
            // Clear function cache for dependent modules
            if (functionCache[dependentFile]) {
              delete functionCache[dependentFile];
              if (debugLogs) {
                this.info(
                  `[vindur-plugin] Cleared function cache for dependent: ${dependentFile}`,
                );
              }
            }

            // Clear virtual CSS for dependent modules
            const dependentVirtualCssId = `virtual:vindur-${getVirtualCssIdPrefix(dependentFile)}.css`;
            if (virtualCssModules.has(dependentVirtualCssId)) {
              virtualCssModules.delete(dependentVirtualCssId);
              const dependentCssModule = moduleGraph.getModuleById(
                dependentVirtualCssId,
              );
              if (dependentCssModule) {
                modulesToInvalidate.push(dependentCssModule);
                hasRelatedVirtualCss = true;
              }
              if (debugLogs) {
                this.info(
                  `[vindur-plugin] Cleared virtual CSS module for dependent: ${dependentVirtualCssId}`,
                );
              }
            }

            // Get the module from Vite's module graph and add to invalidation list
            const dependentModule = moduleGraph.getModuleById(dependentFile);
            if (dependentModule) {
              modulesToInvalidate.push(dependentModule);
              if (debugLogs) {
                this.info(
                  `[vindur-plugin] Added dependent module to invalidation list: ${dependentFile}`,
                );
              }
            }
          }
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
