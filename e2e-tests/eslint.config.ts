import { createBaseConfig } from '../eslint.config.base.js';

export default createBaseConfig({
  extraIgnorePatterns: ['**/test-runs/**', '**/test-results/**'],
  globalRules: {
    '@ls-stack/use-top-level-regex': 0,
  },
});
