export type VindurPluginOptions = {
  /** Path aliases for import resolution */
  importAliases?: Record<string, string>;
  /** Enable dev mode behavior (default: true) */
  dev?: boolean;
  /** Report warnings as ESLint warnings (default: true) */
  reportWarnings?: boolean;
};

export type VindurESLintConfig = {
  plugins: {
    '@vindur': unknown;
  };
  rules: {
    '@vindur/check-transform': 'error' | 'warn' | 'off' | ['error' | 'warn', VindurPluginOptions];
  };
};