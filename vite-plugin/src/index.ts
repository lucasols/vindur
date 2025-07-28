import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { transform, type TransformFS, type TransformFunctionCache } from 'vindur';
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
  
  const cssCache = new Map<string, string>();
  const functionCache: TransformFunctionCache = {};
  let server: ViteDevServer | undefined;

  const fs: TransformFS = {
    readFile: (fileAbsPath: string) => readFileSync(fileAbsPath, 'utf-8'),
  };

  const debug = debugLogs
    ? {
        log: (message: string) => console.info(`[vindur] ${message}`),
        warn: (message: string) => console.warn(`[vindur] ${message}`),
      }
    : undefined;

  return {
    name: 'vindur',
    configureServer(devServer) {
      server = devServer;
    },

    resolveId(id) {
      return id.endsWith('?vindur-css') ? id : null;
    },

    load(id) {
      if (id.endsWith('?vindur-css')) {
        const originalId = id.replace('?vindur-css', '');
        return cssCache.get(originalId) || null;
      }
      return null;
    },

    transform(code, id) {
      if (!shouldTransform(id) || !code.includes('vindur')) {
        return null;
      }

      debug?.log(`Processing file: ${id}`);

      try {
        const result = transform({
          fileAbsPath: id,
          source: code,
          dev: server?.config.command === 'serve',
          debug,
          fs,
          transformFunctionCache: functionCache,
          importAliases,
        });

        if (result.css) {
          cssCache.set(id, result.css);
          const cssId = `${id}?vindur-css`;
          return {
            code: `import "${cssId}";\n${result.code}`,
            map: null,
          };
        }

        return { code: result.code, map: null };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        debug?.log(`Transform failed for: ${id} - ${errorMessage}`);
        
        if (server?.config.command === 'serve') {
          console.warn(`[vindur] Transform failed for ${id}: ${errorMessage}`);
          return null;
        }
        
        this.error(`Vindur transform failed for ${id}: ${errorMessage}`);
      }
    },

    generateBundle() {
      cssCache.clear();
    },

    handleHotUpdate({ file }) {
      if (cssCache.has(file)) {
        cssCache.delete(file);
        debug?.log(`Cleared CSS cache for hot update: ${file}`);
      }
      return undefined;
    },
  };
}
