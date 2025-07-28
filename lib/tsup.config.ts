import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/transform.ts'],
  clean: true,
  dts: true,
  format: ['esm'],
});
