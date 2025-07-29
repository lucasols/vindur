import { vindurPlugin } from '@vindur/vite-plugin';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import Inspect from 'vite-plugin-inspect';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vindurPlugin({
      importAliases: {
        '#src/': fileURLToPath(new URL('./src/', import.meta.url)),
      },
    }),
    react(),
    Inspect(),
  ],
  resolve: {
    alias: {
      '#src/': fileURLToPath(new URL('./src/', import.meta.url)),
    },
  },
});
