import { format } from 'prettier';
import { transform, type TransformFS } from '../src/transform';

type FileTree = { [key: string]: string | FileTree };

export function createFsMock(files: FileTree): TransformFS {
  // walk the file tree and create a map of file paths to their contents
  const fileMap: Record<string, string> = {};

  function walk(tree: FileTree, path: string) {
    for (const [key, value] of Object.entries(tree)) {
      if (key.startsWith('/') || key.endsWith('/') || key.includes('/')) {
        throw new Error(
          `File path cannot start, include or end with a slash: ${key}, it should be just the filename and extension`,
        );
      }

      const fullPath = path ? `${path}/${key}` : `/${key}`;

      if (typeof value === 'string') {
        fileMap[fullPath] = value;
      } else {
        walk(value, fullPath);
      }
    }
  }

  walk(files, '');
  return {
    readFile: (filePath: string) => {
      const file = fileMap[filePath];

      if (!file) {
        throw new Error(`File not found: ${filePath}`);
      }

      return file;
    },
  };
}

export async function formatCode(code: string) {
  return await format(code, { parser: 'typescript' });
}

export async function transformWithFormat({
  source,
  overrideDefaultFs: fs = createFsMock({}),
  overrideDefaultImportAliases: importAliases = { '#/': '/' },
  production,
}: {
  source: string;
  overrideDefaultFs?: TransformFS;
  /** @default false */
  production?: boolean;
  overrideDefaultImportAliases?: Record<string, string>;
}) {
  const result = transform({
    fileAbsPath: '/test.tsx',
    fs,
    importAliases,
    source,
    dev: !production,
  });

  return {
    ...result,
    code: await formatCode(result.code),
    css: await format(result.css, { parser: 'css' }),
  };
}
