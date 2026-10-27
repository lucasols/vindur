import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { invalidateTransformCache, transform } from '../../src/transform';

test('should recompile when a transitive dependency changes', () => {
  const files = {
    '/Box.tsx': dedent`
      import { styled } from 'vindur';
      import { INSET } from '#/styles';

      export const Box = styled.div\`
        top: \${INSET}px;
      \`;
    `,
    '/styles.ts': dedent`
      import { DEFAULT_INSET } from '#/constants';

      export const INSET = DEFAULT_INSET;
    `,
    '/constants.ts': 'export const DEFAULT_INSET = 8;',
  };
  const transformFunctionCache = {};
  const transformBox = () =>
    transform({
      fileAbsPath: '/Box.tsx',
      source: files['/Box.tsx'],
      fs: {
        readFile: (filePath) => {
          if (filePath === '/styles.ts') return files['/styles.ts'];
          if (filePath === '/constants.ts') return files['/constants.ts'];
          throw new Error(`File not found: ${filePath}`);
        },
        exists: (filePath) =>
          filePath === '/styles.ts' || filePath === '/constants.ts',
      },
      transformFunctionCache,
      transformDynamicColorCache: {},
      importAliases: { '#/': '/' },
      dev: true,
    });

  const first = transformBox();
  expect(first.styleDependencies).toEqual(['/styles.ts', '/constants.ts']);
  expect(first.css).toMatchInlineSnapshot(`
    ".v11c9zwh-1-Box {
      top: 8px;
    }"
  `);

  files['/constants.ts'] = 'export const DEFAULT_INSET = 12;';
  invalidateTransformCache(transformFunctionCache, '/constants.ts');

  expect(transformBox().css).toMatchInlineSnapshot(`
    ".v11c9zwh-1-Box {
      top: 12px;
    }"
  `);
});

test('should not list a module as its own dependency in import cycles', () => {
  const files: Record<string, string> = {
    '/A.tsx': dedent`
      import { styled } from 'vindur';
      import { B_SIZE } from '#/B';

      export const A_SIZE = 4;

      export const A = styled.div\`
        top: \${B_SIZE}px;
      \`;
    `,
    '/B.tsx': dedent`
      import { styled } from 'vindur';
      import { A_SIZE } from '#/A';
      import { C_SIZE } from '#/C';

      export const B_SIZE = C_SIZE;

      export const B_TOTAL = A_SIZE;

      export const B = styled.div\`
        top: \${C_SIZE}px;
      \`;
    `,
    '/C.ts': 'export const C_SIZE = 8;',
  };
  const transformFunctionCache = {};
  const transformFile = (fileAbsPath: string) =>
    transform({
      fileAbsPath,
      source: files[fileAbsPath] ?? '',
      fs: {
        readFile: (filePath) => {
          const file = files[filePath];
          if (file === undefined) throw new Error(`File not found: ${filePath}`);
          return file;
        },
        exists: (filePath) => files[filePath] !== undefined,
      },
      transformFunctionCache,
      transformDynamicColorCache: {},
      importAliases: { '#/': '/' },
      dev: true,
    });

  expect(transformFile('/A.tsx').styleDependencies).toEqual([
    '/B.tsx',
    '/C.ts',
  ]);
  expect(transformFile('/B.tsx').styleDependencies).toEqual([
    '/A.tsx',
    '/C.ts',
  ]);
});

test('should recompile when a dependency adds a missing export', () => {
  const files: Record<string, string> = {
    '/Box.tsx': dedent`
      import { styled } from 'vindur';
      import { INSET } from '#/styles';

      export const Box = styled.div\`
        top: \${INSET}px;
      \`;
    `,
    '/styles.ts': dedent`
      import { DEFAULT_INSET } from '#/constants';

      export const INSET = DEFAULT_INSET;
    `,
    '/constants.ts': 'export const OTHER = 8;',
  };
  const transformFunctionCache = {};
  const transformBox = () =>
    transform({
      fileAbsPath: '/Box.tsx',
      source: files['/Box.tsx'] ?? '',
      fs: {
        readFile: (filePath) => {
          const file = files[filePath];
          if (file === undefined) throw new Error(`File not found: ${filePath}`);
          return file;
        },
        exists: (filePath) => files[filePath] !== undefined,
      },
      transformFunctionCache,
      transformDynamicColorCache: {},
      importAliases: { '#/': '/' },
      dev: true,
    });

  expect(() => transformBox()).toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /Box.tsx: "INSET" imported from /styles.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated
    loc: 5:9]
  `);

  files['/constants.ts'] = 'export const DEFAULT_INSET = 8;';
  invalidateTransformCache(transformFunctionCache, '/constants.ts');

  expect(transformBox().css).toMatchInlineSnapshot(`
    ".v11c9zwh-1-Box {
      top: 8px;
    }"
  `);
});
