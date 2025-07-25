import type { TransformFS } from '../src/transform';

export function createFsMock(files: Record<string, string>): TransformFS {
  return {
    readFile: (filePath: string) => {
      const file = files[filePath];

      if (!file) {
        throw new Error(`File not found: ${filePath}`);
      }

      return file;
    },
  };
}
