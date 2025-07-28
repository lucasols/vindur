import { vindurPlugin } from '@vindur/vite-plugin';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import Inspect from 'vite-plugin-inspect';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vindurPlugin({
      importAliases: {},
    }),
    react(),
    Inspect(),
  ],
});
