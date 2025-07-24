import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import Inspect from 'vite-plugin-inspect'
import { viteReactCompiler } from '../lib/src/main'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    viteReactCompiler({
      reactCompilerConfig: {
        target: '18',
      },
    }),
    react(),
    Inspect(),
  ],
})
