import { type Plugin } from "vite";

export type VindurPluginOptions = {
  debugLogs?: boolean;
  importAliases: Record<string, string>;
};

export function vindurPlugin(options: VindurPluginOptions): Plugin {}
