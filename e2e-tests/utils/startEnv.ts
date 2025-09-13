/* eslint-disable no-console -- test file */
import { invariant } from '@ls-stack/utils/assertions';
import { vindurPlugin } from '@vindur/vite-plugin';
import react from '@vitejs/plugin-react-swc';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'path';
import { createServer, build as viteBuild, preview as vitePreview } from 'vite';

const usedPorts = new Set<number>();

type TempFile = {
  path: string;
  read: () => string;
  write: (content: string) => void;
  updateLine: (line: number, replaceWith: string) => void;
  replace: (
    oldOrReplacements: RegExp | string | Array<[RegExp | string, string]>,
    replaceWith?: string,
  ) => void;
  delete: () => void;
  move: (newPath: string) => void;
};

export type TestEnv = {
  baseUrl: string;
  getFile: (relativePath: string) => TempFile;
  createFile: (relativePath: string, content: string) => TempFile;
  getGeneratedCode: () => Promise<string>;
  serverLogs: string[];
  cleanup: () => Promise<void>;
  [Symbol.asyncDispose]: () => Promise<void>;
};

export async function startEnv(
  testId: string,
  initialFiles: Record<string, string> & { 'App.tsx': string },
): Promise<TestEnv> {
  const baseCodeDir = path.join(import.meta.dirname, '..', 'base-code');
  const testsRunsDir = path.join(import.meta.dirname, '..', 'test-runs');

  const testRunDirPath = path.join(testsRunsDir, testId);

  // delete the test run dir if it exists
  removeTestRunDir();

  // Create temporary directory for the test id
  mkdirSync(testRunDirPath, { recursive: true });
  const tempDir = testRunDirPath;

  function removeTestRunDir() {
    if (existsSync(testRunDirPath)) {
      rmSync(testRunDirPath, { recursive: true });
    }
  }

  // Copy base code to temp directory
  cpSync(baseCodeDir, testRunDirPath, { recursive: true });

  function hasRelativeImport(content: string): boolean {
    return (
      content.includes('from "./')
      || content.includes(`from './`)
      || content.includes('from "../')
      || content.includes(`from '../`)
    );
  }

  // Create initial files
  for (const [relativePath, content] of Object.entries(initialFiles)) {
    if (hasRelativeImport(content)) {
      throw new Error(
        `Relative imports are not allowed in the initial files. Please use alias imports instead with "#src" prefix. File: ${relativePath}`,
      );
    }
    createFile(relativePath, content);
  }

  function getSafeRandomPort(): number {
    const min = 3000;
    const max = 9000;
    let port: number;

    do {
      port = Math.floor(Math.random() * (max - min + 1)) + min;
    } while (usedPorts.has(port));

    usedPorts.add(port);
    return port;
  }

  const port = getSafeRandomPort();

  // Capture server logs for error detection
  const serverLogs: string[] = [];
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleInfo = console.info;

  // Override console methods to capture Vite server logs
  console.error = (...args: unknown[]) => {
    const message = args
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');
    serverLogs.push(`ERROR: ${message}`);
    originalConsoleError(...args);
  };

  console.warn = (...args: unknown[]) => {
    const message = args
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');
    serverLogs.push(`WARN: ${message}`);
    originalConsoleWarn(...args);
  };

  console.info = (...args: unknown[]) => {
    const message = args
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');
    serverLogs.push(`INFO: ${message}`);
    originalConsoleInfo(...args);
  };

  // Also capture unhandled errors and exceptions
  const originalProcessUncaughtException =
    process.listeners('uncaughtException');
  const originalProcessUnhandledRejection =
    process.listeners('unhandledRejection');

  process.on('uncaughtException', (error) => {
    serverLogs.push(`UNCAUGHT: ${error.message}`);
    console.log('Captured uncaught exception:', error.message);
  });

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    serverLogs.push(`UNHANDLED_REJECTION: ${message}`);
    console.log('Captured unhandled rejection:', message);
  });

  const server = await createServer({
    plugins: [
      react(),
      vindurPlugin({
        debugLogs: !!process.env.DEBUG,
        importAliases: {
          '#src': tempDir,
        },
      }),
    ],
    configFile: false,
    root: tempDir,
    resolve: {
      alias: {
        '#src': tempDir,
      },
    },
    server: {
      port,
    },
    logLevel: process.env.DEBUG ? 'info' : 'error',
    cacheDir: path.join(testRunDirPath, '.vite'),
  });

  await server.listen();

  const address = server.httpServer?.address();

  invariant(address, 'Address is not defined');

  const url =
    typeof address === 'object' ? `http://localhost:${address.port}` : address;

  function getFile(relativePath: string): TempFile {
    const filePath = path.join(testRunDirPath, relativePath);

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    return {
      path: filePath,
      read: () => readFileSync(filePath, 'utf8'),
      write: (content: string) => writeFileSync(filePath, content),
      updateLine: (line: number, replaceWith: string) => {
        const content = readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        lines[line - 1] = replaceWith;
        writeFileSync(filePath, lines.join('\n'));
      },
      replace: (
        oldOrReplacements: RegExp | string | Array<[RegExp | string, string]>,
        replaceWith?: string,
      ) => {
        let content = readFileSync(filePath, 'utf8');

        if (Array.isArray(oldOrReplacements)) {
          // Multiple replacements
          for (const [old, replacement] of oldOrReplacements) {
            content = content.replace(old, replacement);
          }
        } else {
          // Single replacement
          if (replaceWith === undefined) {
            throw new Error(
              'replaceWith parameter is required for single replacement',
            );
          }
          content = content.replace(oldOrReplacements, replaceWith);
        }

        writeFileSync(filePath, content);
      },
      delete: () => rmSync(filePath),
      move: (newPath: string) => renameSync(filePath, newPath),
    };
  }

  function createFile(relativePath: string, content: string): TempFile {
    const filePath = path.join(testRunDirPath, relativePath);
    const dirPath = path.dirname(filePath);
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(filePath, content);
    return getFile(relativePath);
  }

  async function getGeneratedCode(codePath?: string): Promise<string> {
    const response = await fetch(codePath ? `${url}/${codePath}` : url);
    const html = await response.text();
    return html;
  }

  async function cleanup() {
    await server.close();
    usedPorts.delete(port);

    // Restore original console methods
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.info = originalConsoleInfo;

    // Remove our process listeners
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');

    // Restore original process listeners
    for (const listener of originalProcessUncaughtException) {
      process.on('uncaughtException', listener);
    }
    for (const listener of originalProcessUnhandledRejection) {
      process.on('unhandledRejection', listener);
    }
  }

  return {
    baseUrl: url,
    getFile,
    createFile,
    getGeneratedCode,
    serverLogs,
    cleanup,
    [Symbol.asyncDispose]: cleanup,
  };
}

export async function startEnvProd(
  testId: string,
  initialFiles: Record<string, string> & { 'App.tsx': string },
): Promise<TestEnv> {
  const baseCodeDir = path.join(import.meta.dirname, '..', 'base-code');
  const testsRunsDir = path.join(import.meta.dirname, '..', 'test-runs');

  const testRunDirPath = path.join(testsRunsDir, testId);

  removeTestRunDir();
  mkdirSync(testRunDirPath, { recursive: true });
  const tempDir = testRunDirPath;

  function removeTestRunDir() {
    if (existsSync(testRunDirPath)) {
      rmSync(testRunDirPath, { recursive: true });
    }
  }

  cpSync(baseCodeDir, testRunDirPath, { recursive: true });

  function hasRelativeImport(content: string): boolean {
    return (
      content.includes('from "./')
      || content.includes(`from './`)
      || content.includes('from "../')
      || content.includes(`from '../`)
    );
  }

  for (const [relativePath, content] of Object.entries(initialFiles)) {
    if (hasRelativeImport(content)) {
      throw new Error(
        `Relative imports are not allowed in the initial files. Please use alias imports instead with "#src" prefix. File: ${relativePath}`,
      );
    }
    createFile(relativePath, content);
  }

  function getSafeRandomPort(): number {
    const min = 3000;
    const max = 9000;
    let port: number;
    do {
      port = Math.floor(Math.random() * (max - min + 1)) + min;
    } while (usedPorts.has(port));
    usedPorts.add(port);
    return port;
  }

  const port = getSafeRandomPort();
  const outDir = path.join(testRunDirPath, 'dist');

  await viteBuild({
    plugins: [
      react(),
      vindurPlugin({
        debugLogs: !!process.env.DEBUG,
        importAliases: {
          '#src': tempDir,
        },
        sourcemap: false,
      }),
    ],
    configFile: false,
    root: tempDir,
    resolve: {
      alias: {
        '#src': tempDir,
      },
    },
    build: {
      outDir,
      sourcemap: false,
      emptyOutDir: true,
    },
  });

  const previewServer = await vitePreview({
    preview: { port },
    configFile: false,
    root: tempDir,
    build: { outDir },
  });

  const address = previewServer.httpServer.address();
  invariant(address, 'Address is not defined');
  const url =
    typeof address === 'object' ? `http://localhost:${address.port}` : address;

  function getFile(relativePath: string): TempFile {
    const filePath = path.join(testRunDirPath, relativePath);

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    return {
      path: filePath,
      read: () => readFileSync(filePath, 'utf8'),
      write: (content: string) => writeFileSync(filePath, content),
      updateLine: (line: number, replaceWith: string) => {
        const content = readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        lines[line - 1] = replaceWith;
        writeFileSync(filePath, lines.join('\n'));
      },
      replace: (
        oldOrReplacements: RegExp | string | Array<[RegExp | string, string]>,
        replaceWith?: string,
      ) => {
        let content = readFileSync(filePath, 'utf8');
        if (Array.isArray(oldOrReplacements)) {
          for (const [old, replacement] of oldOrReplacements) {
            content = content.replace(old, replacement);
          }
        } else {
          if (replaceWith === undefined) {
            throw new Error(
              'replaceWith parameter is required for single replacement',
            );
          }
          content = content.replace(oldOrReplacements, replaceWith);
        }
        writeFileSync(filePath, content);
      },
      delete: () => rmSync(filePath),
      move: (newPath: string) => renameSync(filePath, newPath),
    };
  }

  function createFile(relativePath: string, content: string): TempFile {
    const filePath = path.join(testRunDirPath, relativePath);
    const dirPath = path.dirname(filePath);
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(filePath, content);
    return getFile(relativePath);
  }

  async function getGeneratedCode(codePath?: string): Promise<string> {
    const response = await fetch(codePath ? `${url}/${codePath}` : url);
    const html = await response.text();
    return html;
  }

  async function cleanup() {
    await previewServer.close();
    usedPorts.delete(port);
  }

  return {
    baseUrl: url,
    getFile,
    createFile,
    serverLogs: [],
    getGeneratedCode,
    cleanup,
    [Symbol.asyncDispose]: cleanup,
  };
}
