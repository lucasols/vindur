import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../../testUtils';

describe('variable references in function calls', () => {
  test('function call with simple variable reference', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const pixelSize = vindurFn((size: number) => 'width: \${size}px;')
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { pixelSize } from '#/functions'

        const mySize = 24

        const style = css\`
          \${pixelSize(mySize)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        width: 24px;
      }
      "
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const mySize = 24;
      const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function call with arithmetic using variables', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const spacing = vindurFn((margin: number, padding: number) => \`
        margin: \${margin}px;
        padding: \${padding}px;
      \`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { spacing } from '#/functions'

        const baseUnit = 8
        const scale = 2

        const style = css\`
          \${spacing(baseUnit * scale, baseUnit)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        margin: 16px;
        padding: 8px;
      }
      "
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const baseUnit = 8;
      const scale = 2;
      const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function call with string variable', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const colorize = vindurFn((color: string) => 'color: \${color};')
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { colorize } from '#/functions'

        const primaryColor = 'blue'

        const style = css\`
          \${colorize(primaryColor)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        color: blue;
      }
      "
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const primaryColor = "blue";
      const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function call with multiple variable references', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const border = vindurFn((width: number, style: string, color: string) => \`
        border: \${width}px \${style} \${color};
      \`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { border } from '#/functions'

        const borderWidth = 2
        const borderStyle = 'solid'
        const borderColor = 'red'

        const style = css\`
          \${border(borderWidth, borderStyle, borderColor)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        border: 2px solid red;
      }
      "
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const borderWidth = 2;
      const borderStyle = "solid";
      const borderColor = "red";
      const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function call with template literal variable', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const content = vindurFn((text: string) => 'content: "\${text}";')
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { content } from '#/functions'

        const prefix = 'Hello'
        const suffix = 'World'
        const message = \`\${prefix} \${suffix}\`

        const style = css\`
          \${content(message)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        content: "Hello World";
      }
      "
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const prefix = "Hello";
      const suffix = "World";
      const message = \`\${prefix} \${suffix}\`;
      const style = "v1560qbr-1-style";
      "
    `);
  });
});

test('should compare imported constants passed to vindurFn', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { size } from '#/functions';
      import { SIZE } from '#/constants';

      const style = css\`
        \${size(SIZE)};
      \`;
    `,
    overrideDefaultFs: createFsMock({
      'functions.ts': dedent`
        import { vindurFn } from 'vindur';

        export const size = vindurFn((n: number) => \`
          width: \${n === 10 ? 'ten' : 'other'};
          height: \${n > 5 ? 'big' : 'small'};
        \`);
      `,
      'constants.ts': dedent`
        export const SIZE = 10;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const style = "v1560qbr-1-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      width: ten;
      height: big;
    }
    "
  `);
});

test('should throw for dynamic colors passed to functions', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled, createDynamicCssColor } from 'vindur'
        import { paint } from '#/mixins'

        const accent = createDynamicCssColor()

        export const Box = styled.div\`
          \${paint(accent)};
        \`
      `,
      overrideDefaultFs: createFsMock({
        'mixins.ts': dedent`
          import { vindurFn } from 'vindur'

          export const paint = vindurFn((color: string) => \`color: \${color};\`)
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn arguments must be static values: literals, module level constants, or arrays and objects of them. Colors, functions, members of local objects and runtime values can't be passed
    loc: 7:10]
  `);
});

test('should throw for dynamic colors in object arguments of functions', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled, createDynamicCssColor } from 'vindur'
        import { paint } from '#/mixins'

        const accent = createDynamicCssColor()

        export const Box = styled.div\`
          \${paint({ color: accent })};
        \`
      `,
      overrideDefaultFs: createFsMock({
        'mixins.ts': dedent`
          import { vindurFn } from 'vindur'

          export const paint = vindurFn(({ color }: { color: string }) => \`color: \${color};\`)
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn arguments must be static values: literals, module level constants, or arrays and objects of them. Colors, functions, members of local objects and runtime values can't be passed
    loc: 7:10]
  `);
});

test('should evaluate expression arguments of functions', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { space, bg } from '#/mixins'

      const SIZE = 4
      const PRIMARY = 'red'

      export const style = css\`
        \${space(-SIZE)};
        \${bg((PRIMARY) as string)};
        \${bg(\`\${SIZE}px\`)};
      \`
    `,
    overrideDefaultFs: createFsMock({
      'mixins.ts': dedent`
        import { vindurFn } from 'vindur'

        export const space = vindurFn((size: number) => \`margin: \${size}px;\`)
        export const bg = vindurFn((color: string) => \`background: \${color};\`)
      `,
    }),
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      margin: -4px;
      background: red;
      background: 4px;
    }
    "
  `);
});

test('should throw for runtime values passed to functions', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { bg } from '#/mixins'

        export const App = ({ theme }) => <div css={\`\${bg(theme.color)}\`} />
      `,
      overrideDefaultFs: createFsMock({
        'mixins.ts': dedent`
          import { vindurFn } from 'vindur'

          export const bg = vindurFn((color: string) => \`background: \${color};\`)
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn arguments must be static values: literals, module level constants, or arrays and objects of them. Colors, functions, members of local objects and runtime values can't be passed
    loc: 3:50]
  `);
});

test('should throw for local object members passed to functions', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { bg } from '#/mixins'

        const COLORS = { primary: 'red' }

        export const style = css\`
          \${bg(COLORS.primary)};
        \`
      `,
      overrideDefaultFs: createFsMock({
        'mixins.ts': dedent`
          import { vindurFn } from 'vindur'

          export const bg = vindurFn((color: string) => \`background: \${color};\`)
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn arguments must be static values: literals, module level constants, or arrays and objects of them. Colors, functions, members of local objects and runtime values can't be passed
    loc: 7:7]
  `);
});
