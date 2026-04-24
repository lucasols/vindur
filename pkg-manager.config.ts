import { defineConfig } from '@ls-stack/pkg-manager';

export default defineConfig({
  requireMajorConfirmation: true,
  monorepo: {
    packages: [
      { name: 'vindur', path: 'lib' },
      {
        name: '@vindur-css/vite-plugin',
        path: 'vite-plugin',
        dependsOn: ['vindur'],
      },
      {
        name: '@vindur-css/eslint-plugin',
        path: 'eslint-plugin',
        dependsOn: ['vindur'],
      },
    ],
  },
});
