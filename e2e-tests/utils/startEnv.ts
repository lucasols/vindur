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
import { createServer } from 'vite';

const usedPorts = new Set<number>();

type TempFile = {
  path: string;
  read: () => string;
  write: (content: string) => void;
  updateLine: (line: number, replaceWith: string) => void;
  replace: (old: RegExp | string, replaceWith: string) => void;
  delete: () => void;
  move: (newPath: string) => void;
};

export async function startEnv(
  testId: string,
  initialFiles: Record<string, string> & { 'App.tsx': string },
): Promise<{
  baseUrl: string;
  getFile: (relativePath: string) => TempFile;
  createFile: (relativePath: string, content: string) => TempFile;
  getGeneratedCode: () => Promise<string>;
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  const baseCodeDir = path.join(__dirname, '..', 'base-code');
  const testsRunsDir = path.join(__dirname, '..', 'test-runs');

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

  // Create initial files
  for (const [relativePath, content] of Object.entries(initialFiles)) {
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

  const server = await createServer({
    plugins: [
      react(),
      vindurPlugin({
        importAliases: {
          '#src': '/src',
        },
      }),
    ],
    configFile: false,
    root: tempDir,
    resolve: {
      alias: {
        '#src': '/src',
      },
    },
    server: {
      port,
    },
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
      replace: (old: RegExp | string, replaceWith: string) => {
        const content = readFileSync(filePath, 'utf8');
        const newContent = content.replace(old, replaceWith);
        writeFileSync(filePath, newContent);
      },
      delete: () => rmSync(filePath),
      move: (newPath: string) => renameSync(filePath, newPath),
    };
  }

  function createFile(relativePath: string, content: string): TempFile {
    const filePath = path.join(testRunDirPath, relativePath);
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
    removeTestRunDir();
    usedPorts.delete(port);
  }

  return {
    baseUrl: url,
    getFile,
    createFile,
    getGeneratedCode,
    [Symbol.asyncDispose]: cleanup,
  };
}
