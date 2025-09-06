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
  ],
});