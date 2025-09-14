import { existsSync, readFileSync } from 'node:fs';
import { extname, relative } from 'node:path';
import type { SourceMapInput } from 'rollup';
import {
  transform,
  TransformError,
  type TransformFS,
  type TransformFunctionCache,
  type TransformDynamicColorCache,
  type VindurTransformResult,
} from 'vindur/transform';
import { type ModuleNode, type Plugin, type ViteDevServer } from 'vite';

export type VindurPluginOptions = {
  debugLogs?: boolean;
  importAliases: Record<string, string>;
  sourcemap?: boolean;
};

const JS_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];
const VIRTUAL_PREFIX = 'virtual:vindur-';
const RESOLVED_VIRTUAL_PREFIX = `\0${VIRTUAL_PREFIX}`;
const INLINE_SOURCEMAP_RE = /sourceMappingURL=data:application\/json;base64,/;

export function vindurPlugin(options: VindurPluginOptions): Plugin {
  const { debugLogs = false, importAliases = {}, sourcemap } = options;

  type CssVirtualModule = { code: string; map: SourceMapInput | null };
  const virtualCssModules = new Map<string, CssVirtualModule>();
  const sourceCache = new Map<string, VindurTransformResult>();
  const functionCache: TransformFunctionCache = {};
  const dynamicColorCache: TransformDynamicColorCache = {};
  // Track which files depend on which external files (for hot-reload)
  const depToSources = new Map<string, Set<string>>(); // externalFile -> Set<dependentFile>
  const sourceToDeps = new Map<string, Set<string>>(); // sourceFile -> Set<externalFile>
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
      if (id.startsWith(VIRTUAL_PREFIX)) return resolveVirtualId(id);
      return null;
    },

    load(id) {
      if (!id.startsWith(RESOLVED_VIRTUAL_PREFIX)) return null;
      const originalId = id.slice(1); // strip the leading \0
      const mod = virtualCssModules.get(originalId);
      if (!mod) return '';
      // Append inline sourcemap for dev diagnostics if available
      if (mod.map && typeof mod.map === 'object') {
        const hasInlineMap = INLINE_SOURCEMAP_RE.test(mod.code);
        if (!hasInlineMap) {
          const base64 = Buffer.from(JSON.stringify(mod.map)).toString('base64');
          const codeWithMap = `${mod.code}\n/*# sourceMappingURL=data:application/json;base64,${base64} */`;
          return { code: codeWithMap, map: mod.map };
        }
      }
      return { code: mod.code, map: mod.map };
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
          transformDynamicColorCache: dynamicColorCache,
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

      // Expose CSS via a virtual CSS module and inject import
      const virtualId = makeVirtualId(id);
      if (result.css && result.css.length > 0) {
        virtualCssModules.set(virtualId, {
          code: result.css,
          map: result.cssMap ?? null,
        });
      } else {
        virtualCssModules.delete(virtualId);
      }

      // Update dependency graphs for precise HMR
      updateDepGraph(id, result.styleDependencies);
      for (const dep of result.styleDependencies) this.addWatchFile(dep);

      // Cache the transform result for HMR and virtual load()
      sourceCache.set(id, result);

      const codeWithCssImport =
        result.css && result.css.length > 0
          ? injectCssImport(result.code, virtualId)
          : result.code;

      return { code: codeWithCssImport, map: result.map };
    },

    async handleHotUpdate(ctx) {
      const changed = ctx.file;

      // If the changed file is a source, recompile it and return both modules
      if (sourceCache.has(changed)) {
        // Invalidate cached exported functions/colors from this file
        // so re-importers get fresh compiled values
        if (changed in functionCache) delete functionCache[changed];

        const code = await ctx.read();
        const result = transform({
          fileAbsPath: changed,
          source: code,
          dev: true,
          debug:
            debugLogs
              ? {
                  log: (message: string) => console.info(`[vindur] ${message}`),
                  warn: (message: string) => console.warn(`[vindur] ${message}`),
                }
              : undefined,
          fs,
          transformFunctionCache: functionCache,
          transformDynamicColorCache: dynamicColorCache,
          importAliases,
          sourcemap: sourcemap ?? !!devServer,
        });

        const vid = makeVirtualId(changed);
        if (result.css && result.css.length > 0) {
          virtualCssModules.set(vid, {
            code: result.css,
            map: result.cssMap ?? null,
          });
        } else {
          virtualCssModules.delete(vid);
        }
        updateDepGraph(changed, result.styleDependencies);
        sourceCache.set(changed, result);

        return collectSourceAndVirtualModules(ctx.server, changed);
      }

      // If an external dependency changed, recompile all affected sources
      const affected = depToSources.get(changed);
      if (affected && affected.size > 0) {
        const mods: ModuleNode[] = [];
        // Include the changed module(s) so non-vindur updates (like JSX text) still HMR
        for (const m of ctx.modules) mods.push(m);
        for (const srcId of affected) {
          const srcMod = ctx.server.moduleGraph.getModuleById(srcId);
          if (!srcMod) continue;

          // Invalidate compiled fn cache for the changed dep
          if (changed in functionCache) delete functionCache[changed];

          const srcCode = readFileSync(srcId, 'utf8');
          const result = transform({
            fileAbsPath: srcId,
            source: srcCode,
            dev: true,
            debug:
              debugLogs
                ? {
                    log: (message: string) => console.info(`[vindur] ${message}`),
                    warn: (message: string) => console.warn(`[vindur] ${message}`),
                  }
                : undefined,
            fs,
            transformFunctionCache: functionCache,
            transformDynamicColorCache: dynamicColorCache,
            importAliases,
            sourcemap: sourcemap ?? !!devServer,
          });

          const vid = makeVirtualId(srcId);
          if (result.css && result.css.length > 0) {
            virtualCssModules.set(vid, {
              code: result.css,
              map: result.cssMap ?? null,
            });
          } else {
            virtualCssModules.delete(vid);
          }
          updateDepGraph(srcId, result.styleDependencies);
          sourceCache.set(srcId, result);

          const both = collectSourceAndVirtualModules(ctx.server, srcId);
          for (const m of both) mods.push(m);
        }
        return mods;
      }

      return;
    },

    generateBundle() {
      virtualCssModules.clear();
      sourceCache.clear();
      depToSources.clear();
      sourceToDeps.clear();
    },
  };

  function updateDepGraph(sourceId: string, nextDeps: string[]): void {
    const prev = sourceToDeps.get(sourceId) ?? new Set<string>();
    const next = new Set(nextDeps);

    for (const d of prev) {
      if (!next.has(d)) {
        const set = depToSources.get(d);
        if (set) {
          set.delete(sourceId);
          if (set.size === 0) depToSources.delete(d);
        }
      }
    }

    for (const d of next) {
      let set = depToSources.get(d);
      if (!set) depToSources.set(d, (set = new Set<string>()));
      set.add(sourceId);
    }

    sourceToDeps.set(sourceId, next);
  }
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

function makeVirtualId(srcId: string): string {
  const prefix = getVirtualCssIdPrefix(srcId);
  return `${VIRTUAL_PREFIX}${prefix}.css?src=${encodeURIComponent(srcId)}`;
}

function resolveVirtualId(id: string): string {
  // Convert a public virtual id into a resolved id used internally by Vite
  return `${RESOLVED_VIRTUAL_PREFIX}${id.slice(VIRTUAL_PREFIX.length)}`;
}

function injectCssImport(code: string, virtualId: string): string {
  return `import "${virtualId}";\n${code}`;
}

function collectSourceAndVirtualModules(
  server: ViteDevServer,
  srcId: string,
): ModuleNode[] {
  const out: ModuleNode[] = [];
  const m1 = server.moduleGraph.getModuleById(srcId);
  if (m1) out.push(m1);
  const vid = resolveVirtualId(makeVirtualId(srcId));
  const m2 = server.moduleGraph.getModuleById(vid);
  if (m2) out.push(m2);
  return out;
}
