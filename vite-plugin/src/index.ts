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
      const qIndex = id.indexOf('?');
      const base = qIndex === -1 ? id : id.slice(0, qIndex);
      const query = qIndex === -1 ? '' : id.slice(qIndex);
      if (base.startsWith(VIRTUAL_PREFIX)) {
        const resolved = `\u0000${base}${query}`;
        if (debugLogs) this.info(`[vindur-plugin] resolveId -> ${resolved}`);
        return resolved;
      }
      return null;
    },

    load(id) {
      const noPrefix = id.startsWith('\u0000') ? id.slice(1) : id;
      const qIndex = noPrefix.indexOf('?');
      const clean = qIndex === -1 ? noPrefix : noPrefix.slice(0, qIndex);
      if (clean.startsWith(VIRTUAL_PREFIX)) {
        const mod = virtualCssModules.get(clean);
        if (!mod) {
          if (debugLogs) this.info(`[vindur-plugin] load (empty): ${clean}`);
          return { code: '', map: null };
        }
        let code = mod.code;
        if (mod.map) {
          const base64 = Buffer.from(JSON.stringify(mod.map), 'utf-8').toString(
            'base64',
          );
          code = `${code}\n/*# sourceMappingURL=data:application/json;base64,${base64} */`;
        }
        return { code, map: mod.map ?? undefined };
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
        // Also register file watchers so Vite re-runs transform when these change
        if (
          dependency !== id
          && !dependency.includes('node_modules')
          && typeof this.addWatchFile === 'function'
        ) {
          this.addWatchFile(dependency);
          log(`Added watch file for dependency: ${dependency}`);
        }
      }

      if (result.css) {
        log(`Generated CSS for ${id}: ${result.css.slice(0, 100)}...`);

        const virtualCssId = `virtual:vindur-${getVirtualCssIdPrefix(id)}.css`;

        // Store CSS content in virtual module cache
        virtualCssModules.set(virtualCssId, {
          code: result.css,
          map: result.cssMap ?? null,
        });
        log(`Stored virtual CSS module: ${virtualCssId}`);

        // Add CSS import to the transformed code
        const cssImport = `import '${virtualCssId}';`;
        log(`Returning transformed code with CSS import for: ${id}`);

        // Invalidate the virtual CSS module so Vite appends ?t= and pushes HMR update
        if (devServer?.moduleGraph) {
          const resolvedCssId = `\0${virtualCssId}`;
          const cssModule = devServer.moduleGraph.getModuleById(resolvedCssId);
          if (cssModule) {
            devServer.moduleGraph.invalidateModule(cssModule);
            cssModule.lastHMRTimestamp =
              cssModule.lastInvalidationTimestamp || Date.now();
            log(`Invalidated virtual CSS module for HMR: ${virtualCssId}`);
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

    // No handleHotUpdate hook — rely on addWatchFile + module invalidation in transform
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
