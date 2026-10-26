import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

test('should error on imported values that are not static', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { INSET } from '#/styles';

        export const Box = styled.div\`
          top: \${INSET}px;
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          const getInset = () => 8;

          export const INSET = getInset();
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "INSET" imported from /styles.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated
    loc: 5:9]
  `);
});

test('should error on values derived from imported values that are not static', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { INSET } from '#/styles';

        const SIZE = \`\${INSET}px\`;

        export const Box = styled.div\`
          top: \${SIZE};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          const getInset = () => 8;

          export const INSET = getInset();
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... Box = styled\` ... \${SIZE}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
    loc: 7:9
    ignoreInLint: true]
  `);
});

test('should error on values re-exported with `export ... from`', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { INSET } from '#/barrel';

        export const Box = styled.div\`
          top: \${INSET}px;
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'barrel.ts': `export { INSET } from '#/styles';`,
        'styles.ts': 'export const INSET = 8;',
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "INSET" is re-exported by /barrel.ts from "#/styles", re-exports via \`export ... from\` are not supported, import it from "#/styles" directly
    loc: 5:9]
  `);
});

test('should error on values that may come from `export * from`', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { px } from '#/barrel';

        export const Box = styled.div\`
          top: \${px(8)};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'barrel.ts': `export * from '#/fns';`,
        'fns.ts': dedent`
          import { vindurFn } from 'vindur';

          export const px = vindurFn((value: number) => \`\${value}px\`);
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "px" not found in /barrel.ts, re-exports via \`export * from\` are not supported, import it from the module that declares it directly
    loc: 5:9]
  `);
});

test('should explain values missing because of an import cycle', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { AB } from '#/a';

        export const Box = styled.div\`
          top: \${AB}px;
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'a.ts': dedent`
          import { B } from '#/b';

          export const A = 1;
          export const AB = A + B;
        `,
        'b.ts': dedent`
          import { A } from '#/a';

          export const B = 2;
          export const BA = B + A;
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "AB" imported from /a.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated, note that /a.ts has an import cycle with /b.ts, values that depend on modules in an import cycle can't be evaluated statically
    loc: 5:9]
  `);
});

test('should resolve relative re-export sources in errors', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { INSET } from '#/ui/index';

        export const Box = styled.div\`
          top: \${INSET}px;
        \`;
      `,
      overrideDefaultFs: createFsMock({
        ui: {
          'index.ts': `export { INSET } from './styles';`,
          'styles.ts': 'export const INSET = 8;',
        },
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "INSET" is re-exported by /ui/index.ts from "/ui/styles", re-exports via \`export ... from\` are not supported, import it from "/ui/styles" directly
    loc: 5:9]
  `);
});

test('should error on exported functions of modules with `export * from`', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { getInset } from '#/barrel';

        export const Box = styled.div\`
          top: \${getInset}px;
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'barrel.ts': dedent`
          export * from '#/fns';

          export function getInset() {
            return 8;
          }
        `,
        'fns.ts': 'export const GAP = 4;',
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "getInset" imported from /barrel.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated
    loc: 5:9]
  `);
});
