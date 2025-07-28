import { cpSync, existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { execSync } from 'child_process'
// import vindur from '@vindur/vite'

export async function startVite(testName: string) {
  const baseCodeDir = path.join(__dirname, '..', 'base-code')
  
  // Create temporary directory
  const tempDir = mkdtempSync(path.join(tmpdir(), `vindur-e2e-${testName}-`))

  function removeDir(dir: string) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true })
    }
  }

  // Copy base code to temp directory
  cpSync(baseCodeDir, tempDir, { recursive: true })

  // Symlink node_modules from e2e-tests directory
  const e2eNodeModules = path.join(__dirname, '..', 'node_modules')
  const tempNodeModules = path.join(tempDir, 'node_modules')
  
  try {
    require('fs').symlinkSync(e2eNodeModules, tempNodeModules, 'dir')
  } catch (error) {
    // If symlink fails, try copying (fallback)
    console.warn('Symlink failed, copying node_modules:', error)
    cpSync(e2eNodeModules, tempNodeModules, { recursive: true })
  }

  // Create package.json in temp directory with required dependencies
  const packageJson = {
    "name": "vindur-e2e-test",
    "private": true,
    "version": "0.0.0",
    "type": "module",
    "dependencies": {
      "react": "^18.2.0",
      "react-dom": "^18.2.0",
      "vindur": "workspace:*"
    },
    "devDependencies": {
      "@types/react": "^18.0.15",
      "@types/react-dom": "^18.0.6"
    }
  }
  require('fs').writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2))

  const server = await createServer({
    plugins: [
      react(),
    ],
    configFile: false,
    root: tempDir,
    resolve: {
      alias: {
        'vindur': path.resolve(__dirname, '../../lib/src/main.ts'),
      }
    },
    server: {
      port: 0, // Use dynamic port to avoid conflicts
    },
  })

  await server.listen()

  const address = server.httpServer?.address()
  const port = typeof address === 'object' ? address?.port : address

  function updateFile(
    file: string,
    { old, replaceWith }: { old: RegExp; replaceWith: string },
  ) {
    const filePath = path.join(tempDir, file)
    const content = readFileSync(filePath, 'utf8')

    const newContent = content.replace(old, replaceWith)

    require('fs').writeFileSync(filePath, newContent)
  }

  function updateFileLine(file: string, line: number, replaceWith: string) {
    const filePath = path.join(tempDir, file)
    const content = readFileSync(filePath, 'utf8')

    const lines = content.split('\n')
    lines[line - 1] = replaceWith

    require('fs').writeFileSync(filePath, lines.join('\n'))
  }

  function cleanup() {
    removeDir(tempDir)
  }

  return { server, port, updateFile, updateFileLine, cleanup, tempDir }
}