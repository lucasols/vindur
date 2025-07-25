import type { TransformFS } from '../src/transform';

type FileTree = { [key: string]: string | FileTree };

export function createFsMock(files: FileTree): TransformFS {
  // walk the file tree and create a map of file paths to their contents
  const fileMap: Record<string, string> = {};

  const walk = (tree: FileTree, path: string) => {
    for (const [key, value] of Object.entries(tree)) {
      if (key.startsWith('/') || key.endsWith('/')) {
        throw new Error(
          `File path cannot start or end with a slash: ${key}, it should be just the filename and extension`,
        );
      }

      const fullPath = path ? `${path}/${key}` : key;

      if (typeof value === 'string') {
        fileMap[fullPath] = value;
      } else {
        walk(value, fullPath);
      }
    }
  };

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
