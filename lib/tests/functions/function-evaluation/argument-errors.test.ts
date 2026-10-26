import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../../testUtils';

test('should error when a theme color without .var is passed to a vindurFn', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createStaticThemeColors, css } from 'vindur';
        import { border } from '#/functions';

        const colors = createStaticThemeColors({ primary: '#ff0000' });

        const style = css\`
          \${border(colors.primary)};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'functions.ts': dedent`
          import { vindurFn } from 'vindur';

          export const border = vindurFn((color: string) => \`border: 1px solid \${color};\`);
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Argument of vindurFn "border" has no CSS value, only literals, module constants, and arrays or objects of them are supported, use \`.var\` to pass a color
    loc: 7:11]
  `);
});

test('should pass a theme color method with a constant amount to a vindurFn', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createStaticThemeColors, css } from 'vindur';
      import { border } from '#/functions';

      const HALF = 0.5;

      const colors = createStaticThemeColors({ primary: '#ff0000' });

      const style = css\`
        \${border(colors.primary.alpha(HALF))};
      \`;
    `,
    overrideDefaultFs: createFsMock({
      'functions.ts': dedent`
        import { vindurFn } from 'vindur';

        export const border = vindurFn((color: string) => \`border: 1px solid \${color};\`);
      `,
    }),
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      border: 1px solid var(--stc-primary-alpha-0\\.5, #ff000080);
    }
    "
  `);
});

test('should error when a vindurFn is called with too many arguments', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import { size } from '#/functions';

        const style = css\`
          \${size(1, 2)};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'functions.ts': dedent`
          import { vindurFn } from 'vindur';

          export const size = vindurFn((value: number) => \`width: \${value}px;\`);
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "size" accepts 1 argument(s) but was called with 2
    loc: /test.tsx|5:4]
  `);
});

test('should error when a vindurFn argument does not match its parameter', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import { size } from '#/functions';

        const style = css\`
          \${size(3)};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'functions.ts': dedent`
          import { vindurFn } from 'vindur';

          export const size = vindurFn(({ width }: { width: number }) => \`width: \${width}px;\`);
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "size" can't be evaluated with these arguments, check that they match its parameters
    loc: /test.tsx|5:4]
  `);
});

test('should error on a parameter default referencing a module constant', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        const SIZE = 4;

        export const size = vindurFn((value: number = SIZE) => \`width: \${value}px;\`);
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "size" parameter defaults can only use literals and other parameters, "SIZE" is not supported
    loc: /test.tsx|5:46]
  `);
});

test('should error when an imported object with a __proto__ setter is passed to a vindurFn', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import { size } from '#/functions';
        import { VALUES } from '#/values';

        const style = css\`
          \${size(VALUES)};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'functions.ts': dedent`
          import { vindurFn } from 'vindur';

          export const size = vindurFn(({ width = 4 }: { width?: number }) => \`width: \${width}px;\`);
        `,
        'values.ts': dedent`
          export const VALUES = { __proto__: { width: 8 } };
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "VALUES" from /values.ts can't be evaluated at compile time, only static values (strings, numbers, and arrays or objects of them) can be used in vindur styles
    loc: 6:9]
  `);
});

test('should error when a css style is passed to a vindurFn', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import { hover } from '#/functions';

        const base = css\`
          color: red;
        \`;

        const style = css\`
          \${hover(base)};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'functions.ts': dedent`
          import { vindurFn } from 'vindur';

          export const hover = vindurFn((selector: string) => \`\${selector}:hover { color: blue; }\`);
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Argument of vindurFn "hover" is a css style, which can't be passed to a vindurFn, extend it in the calling template with \`\${style};\` instead
    loc: 9:10]
  `);
});

test('should error when a missing vindurFn argument is used in CSS', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import { margin } from '#/functions';

        const style = css\`
          \${margin(1)};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'functions.ts': dedent`
          import { vindurFn } from 'vindur';

          export const margin = vindurFn((top: number, bottom?: number) => \`margin: \${top}px \${bottom};\`);
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "margin" was called with 1 of its 2 argument(s), a missing argument is undefined and can't be used in CSS, pass it or give its parameter a default
    loc: /test.tsx|5:4]
  `);
});

test('should error on rest parameters in vindurFn', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const sizes = vindurFn((...values: number[]) => values.join(' '));
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "sizes" rest parameters are not supported, declare each parameter
    loc: /test.tsx|3:31]
  `);
});

test('should error on rest properties in vindurFn object parameters', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const box = vindurFn(({ width, ...rest }: { width: number; height: number }) => \`width: \${width}px;\`);
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "box" rest parameters are not supported, declare each parameter
    loc: /test.tsx|3:38]
  `);
});
