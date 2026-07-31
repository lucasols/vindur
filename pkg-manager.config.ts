import { defineConfig } from '@ls-stack/pkg-manager';

export default defineConfig({
  requireMajorConfirmation: true,
  monorepo: {
    packages: [
      {
        name: '@vindur/native',
        path: 'native',
        release: { type: 'napi', npmDir: 'npm' },
      },
      { name: 'vindur', path: 'lib', dependsOn: ['@vindur/native'] },
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
