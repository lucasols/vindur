import { checkTransformRule } from './rules/check-transform';
import type { VindurPluginOptions, VindurESLintConfig } from './types';

export type { VindurPluginOptions, VindurESLintConfig };

type PluginType = {
  meta: {
    name: string;
    version: string;
  };
  rules: {
    'check-transform': typeof checkTransformRule;
  };
  configs: {
    recommended?: {
      plugins: {
        '@vindur': unknown;
      };
      rules: {
        '@vindur/check-transform': ['error'] | ['error', VindurPluginOptions];
      };
    };
  };
};

const plugin: PluginType = {
  meta: {
    name: '@vindur/eslint-plugin',
    version: '0.1.0',
  },
  rules: {
    'check-transform': checkTransformRule,
  },
  configs: {},
};

// Add configs after plugin is defined to avoid circular reference
plugin.configs = {
  recommended: {
    plugins: {
      '@vindur': plugin,
    },
    rules: {
      '@vindur/check-transform': ['error'],
    },
  },
};

export const vindurPlugin = plugin;