import fs from "node:fs";
import path from "node:path";
import {
  transform,
  type TransformFS,
  type TransformFunctionCache,
  type TransformOptions,
} from "vindur";
import { type Plugin } from "vite";
import type { DebugLogger } from "../../lib/src/babel-plugin";

export type VindurPluginOptions = {
  dev?: boolean;
  debug?: boolean;
  importAliases?: Record<string, string>;
};

type VindurPlugin = Plugin & {
  __vindurPlugin: true;
};

export function vindurPlugin(options: VindurPluginOptions = {}): VindurPlugin {
  const {
    dev = process.env.NODE_ENV === "development",
    debug = false,
    importAliases = {},
  } = options;

  const transformFS: TransformFS = {
    readFile: (fileAbsPath: string) => {
      return fs.readFileSync(fileAbsPath, "utf-8");
    },
  };

  const transformFunctionCache: TransformFunctionCache = {};

  const debugLogger: DebugLogger | undefined = debug
    ? { log: console.log }
    : undefined;

  return {
    name: "vindur",
    __vindurPlugin: true,
    enforce: "pre",

    transform(code: string, id: string) {
      // Only process TypeScript/JavaScript files
      if (
        !id.includes(".ts") &&
        !id.includes(".js") &&
        !id.includes(".tsx") &&
        !id.includes(".jsx")
      ) {
        return null;
      }

      // Skip node_modules
      if (id.includes("node_modules")) {
        return null;
      }

      // Skip if the file doesn't contain any vindur functions
      if (
        !code.includes("css`") &&
        !code.includes("styled.") &&
        !code.includes("css={") &&
        !code.includes("cx={") &&
        !code.includes("vindurFn") &&
        !code.includes("keyframes`") &&
        !code.includes("createGlobalStyle`") &&
        !code.includes("createStaticThemeColors") &&
        !code.includes("createDynamicCssColor")
      ) {
        return null;
      }

      try {
        const transformOptions: TransformOptions = {
          fileAbsPath: path.resolve(id),
          source: code,
          dev,
          debug: debugLogger,
          fs: transformFS,
          transformFunctionCache,
          importAliases,
        };

        const result = transform(transformOptions);

        // If there's CSS, we need to inject it into the page
        if (result.css) {
          const cssInjectionCode = `
if (typeof document !== 'undefined') {
  const styleId = 'vindur-styles-${path.basename(id)}';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = ${JSON.stringify(result.css)};
    document.head.appendChild(style);
  }
}`;

          return {
            code: `${cssInjectionCode}\n${result.code}`,
            map: null,
          };
        }

        return {
          code: result.code,
          map: null,
        };
      } catch (error) {
        this.error(
          `Vindur transform failed for ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return null;
      }
    },
  };
}
