import { invariant } from "@ls-stack/utils/assertions";
import { vindurPlugin } from "@vindur/vite-plugin";
import react from "@vitejs/plugin-react-swc";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "path";
import { createServer } from "vite";

export async function startEnv(
  testId: string,
  initialFiles: Record<string, string> & { "App.tsx": string }
) {
  const baseCodeDir = path.join(__dirname, "..", "base-code");
  const testsRunsDir = path.join(__dirname, "..", "test-runs");

  const testRunDirPath = path.join(testsRunsDir, testId);

  // delete the test run dir if it exists
  removeTestRunDir();

  // Create temporary directory for the test id
  const tempDir = mkdtempSync(testRunDirPath);

  function removeTestRunDir() {
    if (existsSync(testRunDirPath)) {
      rmSync(testRunDirPath, { recursive: true });
    }
  }

  // Copy base code to temp directory
  cpSync(baseCodeDir, tempDir, { recursive: true });

  // Create initial files
  for (const [relativePath, content] of Object.entries(initialFiles)) {
    createFile(relativePath, content);
  }

  const server = await createServer({
    plugins: [react(), vindurPlugin()],
    configFile: false,
    root: tempDir,
    resolve: {
      alias: {
        "#src": "/src",
      },
    },
  });

  await server.listen();

  const address = server.httpServer?.address();

  invariant(address, "Address is not defined");

  const url =
    typeof address === "object" ? `http://localhost:${address.port}` : address;

  type TempFile = {
    path: string;
    read: () => string;
    write: (content: string) => void;
    updateLine: (line: number, replaceWith: string) => void;
    replace: (old: RegExp | string, replaceWith: string) => void;
    delete: () => void;
    move: (newPath: string) => void;
  };

  function getFile(relativePath: string): TempFile {
    const filePath = path.join(tempDir, relativePath);

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    return {
      path: filePath,
      read: () => readFileSync(filePath, "utf8"),
      write: (content: string) => writeFileSync(filePath, content),
      updateLine: (line: number, replaceWith: string) => {
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n");
        lines[line - 1] = replaceWith;
        writeFileSync(filePath, lines.join("\n"));
      },
      replace: (old: RegExp | string, replaceWith: string) => {
        const content = readFileSync(filePath, "utf8");
        const newContent = content.replace(old, replaceWith);
        writeFileSync(filePath, newContent);
      },
      delete: () => rmSync(filePath),
      move: (newPath: string) => renameSync(filePath, newPath),
    };
  }

  function createFile(relativePath: string, content: string): TempFile {
    const filePath = path.join(tempDir, relativePath);
    writeFileSync(filePath, content);
    return getFile(relativePath);
  }

  function cleanup() {
    removeTestRunDir();
  }

  return { server, port: url, cleanup, tempDir, getFile, createFile };
}
