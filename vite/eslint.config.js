import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const baseConfig = require('../lib/eslint.config.js');

export default baseConfig;