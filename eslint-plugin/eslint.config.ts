import { createBaseConfig, OFF } from '../eslint.config.base.js';

export default createBaseConfig({
  extraRuleGroups: [
    {
      files: ['src/rules/*.ts', 'tests/*.ts'],
      rules: {
        '@typescript-eslint/no-unsafe-assignment': OFF,
        '@typescript-eslint/no-unsafe-member-access': OFF,
        '@typescript-eslint/consistent-type-assertions': OFF,
        '@typescript-eslint/no-unsafe-argument': OFF,
        '@typescript-eslint/unbound-method': OFF,
      },
    },
    {
      // oxlint loads JS plugins from the module default export
      files: ['src/index.ts'],
      rules: {
        '@ls-stack/no-default-export': OFF,
      },
    },
  ],
});