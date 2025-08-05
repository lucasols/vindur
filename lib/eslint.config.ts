import { createBaseConfig, OFF } from '../eslint.config.base.js';

export default createBaseConfig({
  extraRuleGroups: [
    {
      files: ['src/main.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': OFF,
        '@typescript-eslint/no-unsafe-assignment': OFF,
        '@typescript-eslint/no-empty-object-type': OFF,
        '@typescript-eslint/no-unused-vars': OFF,
        '@typescript-eslint/consistent-type-assertions': OFF,
      },
    },
    {
      files: ['**/main-runtime-type-tests.tsx'],
      rules: {
        '@typescript-eslint/no-unused-vars': OFF,
      },
    },
  ],
});
