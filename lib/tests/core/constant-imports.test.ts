import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('constant imports', () => {
  test('should import string constants from another file', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { primaryColor, secondaryColor } from '#/constants'

        const Button = styled.button\`
          background: \${primaryColor};
          color: \${secondaryColor};
          padding: 12px 24px;
          border: none;
        \`

        const App = () => <Button>Click me</Button>
      `,

      overrideDefaultFs: createFsMock({
        'constants.ts': dedent`
          export const primaryColor = '#007bff'
          export const secondaryColor = 'white'
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <button className="v1560qbr-1-Button">Click me</button>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: #007bff;
        color: white;
        padding: 12px 24px;
        border: none;
      }
      "
    `);
  });

  test('should import number constants from another file', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { spacing, borderRadius } from '#/constants'

        const cardStyles = css\`
          padding: \${spacing}px;
          margin: \${spacing / 2}px;
          border-radius: \${borderRadius}px;
          background: white;
        \`

        const App = () => <div className={cardStyles}>Card</div>
      `,

      overrideDefaultFs: createFsMock({
        'constants.ts': dedent`
          export const spacing = 16
          export const borderRadius = 8
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const cardStyles = "v1560qbr-1-cardStyles";
      const App = () => <div className={cardStyles}>Card</div>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-cardStyles {
        padding: 16px;
        margin: 8px;
        border-radius: 8px;
        background: white;
      }
      "
    `);
  });

  test('should import mixed string and number constants', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { brandColor, fontSize, fontWeight } from '#/theme'

        const Title = styled.h1\`
          color: \${brandColor};
          font-size: \${fontSize}px;
          font-weight: \${fontWeight};
          margin-bottom: 16px;
        \`

        const App = () => <Title>Hello World</Title>
      `,
      overrideDefaultFs: createFsMock({
        'theme.ts': dedent`
          export const brandColor = '#2563eb'
          export const fontSize = 24
          export const fontWeight = 600
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <h1 className="v1560qbr-1-Title">Hello World</h1>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Title {
        color: #2563eb;
        font-size: 24px;
        font-weight: 600;
        margin-bottom: 16px;
      }
      "
    `);
  });

  test('should import constants used in arithmetic expressions', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { baseSpacing } from '#/constants'

        const styles = css\`
          padding: \${baseSpacing * 2}px \${baseSpacing}px;
          margin: \${baseSpacing / 2}px;
          border-width: \${baseSpacing / 8}px;
        \`

        const App = () => <div className={styles}>Content</div>
      `,
      overrideDefaultFs: createFsMock({
        'constants.ts': dedent`
          export const baseSpacing = 16
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-1-styles";
      const App = () => <div className={styles}>Content</div>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        padding: 32px 16px;
        margin: 8px;
        border-width: 2px;
      }
      "
    `);
  });

  test('should import constants from multiple files', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { primaryColor } from '#/colors'
        import { spacing } from '#/layout'

        const Card = styled.div\`
          background: \${primaryColor};
          padding: \${spacing}px;
          border-radius: 8px;
        \`

        const App = () => <Card>Card content</Card>
      `,
      overrideDefaultFs: createFsMock({
        'colors.ts': dedent`
          export const primaryColor = '#3b82f6'
          export const secondaryColor = '#64748b'
        `,
        'layout.ts': dedent`
          export const spacing = 20
          export const borderRadius = 12
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <div className="v1560qbr-1-Card">Card content</div>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        background: #3b82f6;
        padding: 20px;
        border-radius: 8px;
      }
      "
    `);
  });

  test('should import constants with string template literals', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { baseFont, fontWeight } from '#/typography'

        const Text = styled.p\`
          font-family: \${baseFont};
          font-weight: \${fontWeight};
          line-height: 1.5;
        \`

        const App = () => <Text>Sample text</Text>
      `,
      overrideDefaultFs: createFsMock({
        'typography.ts': dedent`
          const fontFamily = 'Inter'
          export const baseFont = \`\${fontFamily}, system-ui, sans-serif\`
          export const fontWeight = 400
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <p className="v1560qbr-1-Text">Sample text</p>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Text {
        font-family: Inter, system-ui, sans-serif;
        font-weight: 400;
        line-height: 1.5;
      }
      "
    `);
  });

  test('should throw error when imported constant is not found', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'
          import { unknownConstant } from '#/constants'

          const Button = styled.button\`
            color: \${unknownConstant};
          \`
        `,
        overrideDefaultFs: createFsMock({
          'constants.ts': dedent`
            export const primaryColor = '#007bff'
          `,
        }),
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: "unknownConstant" not found in /constants.ts
      loc: 5:11]
    `,
    );
  });

  test('should support mixed imports of constants and CSS styles', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { baseStyles } from '#/styles'
        import { primaryColor, spacing } from '#/constants'

        const Card = styled.div\`
          \${baseStyles};
          background: \${primaryColor};
          padding: \${spacing}px;
        \`

        const App = () => <Card>Content</Card>
      `,
      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          import { css } from 'vindur'

          export const baseStyles = css\`
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          \`
        `,
        'constants.ts': dedent`
          export const primaryColor = '#10b981'
          export const spacing = 24
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <div className="v1560qbr-1-Card">Content</div>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        background: #10b981;
        padding: 24px;
      }
      "
    `);
  });
});

test('should error on imported values that cannot be evaluated', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { gap } from '#/constants'

        const style = css\`
          gap: \${gap};
        \`
      `,
      overrideDefaultFs: createFsMock({
        'constants.ts': dedent`
          const rem = (value: number) => \`\${value}rem\`

          export const gap = rem(4)
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "gap" imported from /constants.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated
    loc: 5:9]
  `);
});

test('should error on imported values that cannot be evaluated in vindurFn arguments', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { margin } from '#/functions'
        import { gap } from '#/constants'

        const style = css\`
          \${margin(gap)};
        \`
      `,
      overrideDefaultFs: createFsMock({
        'constants.ts': dedent`
          export let gap = '4px'
        `,
        'functions.ts': dedent`
          import { vindurFn } from 'vindur'

          export const margin = vindurFn((value: string) => \`margin: \${value};\`)
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "gap" imported from /constants.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated
    loc: 6:4]
  `);
});

test('should error on vindurFn arguments that cannot be evaluated', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { margin } from '#/functions'
        import { gap } from '#/constants'

        const style = css\`
          \${margin({ value: gap })};
        \`
      `,
      overrideDefaultFs: createFsMock({
        'constants.ts': dedent`
          const rem = (value: number) => \`\${value}rem\`

          export const gap = rem(4)
        `,
        'functions.ts': dedent`
          import { vindurFn } from 'vindur'

          export const margin = vindurFn(({ value }: { value: string }) => \`margin: \${value};\`)
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Argument of vindurFn "margin" can't be evaluated at compile time, only literals, module constants, and arrays or objects of them are supported
    loc: 6:11]
  `);
});

test('should error on interpolating an uncalled vindurFn', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { margin } from '#/functions'

        const style = css\`
          margin: \${margin};
        \`
      `,
      overrideDefaultFs: createFsMock({
        'functions.ts': dedent`
          import { vindurFn } from 'vindur'

          export const margin = vindurFn((value: string) => \`margin: \${value};\`)
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... style = css\` ... \${margin}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
    loc: 5:12
    ignoreInLint: true]
  `);
});

test('should evaluate module constants computed from imported values', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { SIZE } from '#/constants'
      import { padding } from '#/functions'

      const DOUBLE = SIZE * 2

      const style = css\`
        width: \${DOUBLE}px;
        \${padding(DOUBLE)};
      \`
    `,
    overrideDefaultFs: createFsMock({
      'constants.ts': dedent`
        export const SIZE = 4
      `,
      'functions.ts': dedent`
        import { vindurFn } from 'vindur'

        export const padding = vindurFn((value: number) => \`padding: \${value}px;\`)
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { SIZE } from "#/constants";
    const DOUBLE = SIZE * 2;
    const style = "v1560qbr-1-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      width: 8px;
      padding: 8px;
    }
    "
  `);
});

test('should resolve imported constants by their exported name', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { PRIMARY } from '#/colors'

      const style = css\`
        color: \${PRIMARY};
      \`
    `,
    overrideDefaultFs: createFsMock({
      'colors.ts': dedent`
        const COLOR = 'red'

        export { COLOR as PRIMARY }
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const style = "v1560qbr-1-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      color: red;
    }
    "
  `);
});

test('should not resolve named imports of a default exported constant', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { COLOR } from '#/colors'

        const style = css\`
          color: \${COLOR};
        \`
      `,
      overrideDefaultFs: createFsMock({
        'colors.ts': dedent`
          const COLOR = 'red'

          export default COLOR
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "COLOR" not found in /colors.ts
    loc: 5:11]
  `);
});
