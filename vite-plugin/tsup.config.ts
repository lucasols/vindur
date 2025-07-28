import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['vite', 'node:fs', 'node:path'],
  target: 'node18',
  bundle: true,
});