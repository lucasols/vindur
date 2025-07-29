import { vindurPlugin } from '@vindur/vite-plugin';
import react from '@vitejs/plugin-react-swc';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import Inspect from 'vite-plugin-inspect';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vindurPlugin({
      importAliases: {
        '#src/': fileURLToPath(new URL('./src/', import.meta.url)),
      },
      sourcemap: true,
    }),
    react(),
    Inspect(),
  ],
  resolve: {
    alias: {
      '#src/': fileURLToPath(new URL('./src/', import.meta.url)),
    },
  },
  build: {
    sourcemap: true,
  },
});
