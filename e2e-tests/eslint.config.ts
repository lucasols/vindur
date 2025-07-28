import { createBaseConfig } from '../eslint.config.base.js';

export default createBaseConfig({
  extraIgnorePatterns: ['**/test-runs/**', '**/test-results/**'],
});
