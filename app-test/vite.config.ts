import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import Inspect from 'vite-plugin-inspect'
import vindur from '@vindur/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vindur({
      dev: true,
      debug: false,
      importAliases: {},
    }),
    react(),
    Inspect(),
  ],
})
