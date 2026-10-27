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

test('should error on re-exported values used as arguments or operands', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { INSET } from '#/barrel';
        import { px } from '#/fns';

        export const Box = styled.div\`
          top: \${px(INSET + 1)};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'barrel.ts': `export { INSET } from '#/styles';`,
        'styles.ts': 'export const INSET = 8;',
        'fns.ts': dedent`
          import { vindurFn } from 'vindur';

          export const px = vindurFn((value: number) => \`\${value}px\`);
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "INSET" is re-exported by /barrel.ts from "#/styles", re-exports via \`export ... from\` are not supported, import it from "#/styles" directly
    loc: 6:9]
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
    [TransformError: /test.tsx: "INSET" is re-exported by /ui/index.ts from "./ui/styles", re-exports via \`export ... from\` are not supported, import it from "./ui/styles" directly
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

test('should error on values derived from imported keyframes', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import { ANIMATION } from '#/animation';

        const style = css\`
          animation: \${ANIMATION};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'animation.ts': dedent`
          import { fadeIn } from '#/keyframes';

          export const ANIMATION = \`\${fadeIn} 1s\`;
        `,
        'keyframes.ts': dedent`
          import { keyframes } from 'vindur';

          export const fadeIn = keyframes\`
            from { opacity: 0; }
            to { opacity: 1; }
          \`;
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "ANIMATION" imported from /animation.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated
    loc: 5:15]
  `);
});

test('should error on values derived from imported dynamic colors', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import { color } from '#/colors';

        const value = \`\${color}\`;

        const style = css\`
          color: \${value};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'colors.ts': dedent`
          import { createDynamicCssColor } from 'vindur';

          export const color = createDynamicCssColor();
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... style = css\` ... \${value}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
    loc: 7:11
    ignoreInLint: true]
  `);
});

test('should suggest the original name of values re-exported with an alias', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { GAP } from '#/barrel';

        export const Box = styled.div\`
          top: \${GAP}px;
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'barrel.ts': `export { INSET as GAP } from '#/styles';`,
        'styles.ts': 'export const INSET = 8;',
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "GAP" is re-exported by /barrel.ts from "#/styles", re-exports via \`export ... from\` are not supported, import "INSET" from "#/styles" directly
    loc: 5:9]
  `);
});

test('should error on namespaces re-exported with `export * as`', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { tokens } from '#/barrel';

        export const Box = styled.div\`
          top: \${tokens.INSET}px;
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'barrel.ts': `export * as tokens from '#/styles';`,
        'styles.ts': 'export const INSET = 8;',
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "tokens" is re-exported by /barrel.ts from "#/styles", re-exports via \`export * as ... from\` are not supported, import the values you need from "#/styles" by name
    loc: 5:9]
  `);
});

test('should error on imported values that are not static used as arguments', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { INSET } from '#/styles';
        import { px } from '#/fns';

        export const Box = styled.div\`
          top: \${px(INSET)};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          const getInset = () => 8;

          export const INSET = getInset();
        `,
        'fns.ts': dedent`
          import { vindurFn } from 'vindur';

          export const px = vindurFn((value: number) => \`\${value}px\`);
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "INSET" imported from /styles.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated
    loc: 6:9]
  `);
});

test('should report unresolved values exported by name as values of the exporting module', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { INSET } from '#/lib/styles';

        export const Box = styled.div\`
          top: \${INSET}px;
        \`;
      `,
      overrideDefaultFs: createFsMock({
        lib: {
          'styles.ts': dedent`
            import { INSET } from './barrel';

            export { INSET };
          `,
          'barrel.ts': `export { INSET } from './ui/constants';`,
          ui: { 'constants.ts': 'export const INSET = 8;' },
        },
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "INSET" imported from /lib/styles.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated
    loc: 5:9]
  `);
});

test('should error on values derived from imported theme colors', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import { colors } from '#/colors';

        const border = \`1px solid \${colors.primary.value}\`;

        const style = css\`
          border: \${border};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'colors.ts': dedent`
          import { createStaticThemeColors } from 'vindur';

          export const colors = createStaticThemeColors({ primary: '#ff0000' });
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... style = css\` ... \${border}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
    loc: 7:12
    ignoreInLint: true]
  `);
});
