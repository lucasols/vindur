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
      [TransformError: /test.tsx: Function "unknownConstant" not found in /constants.ts
      loc: {
        "column": 6,
        "filename": "/constants.ts",
        "line": 4,
      }]
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
      "import "#/styles";
      const App = () => (
        <div className="v1s4vg6s-1-baseStyles v1560qbr-1-Card">Content</div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        background: #10b981;
        padding: 24px;
      }
      "
    `);
  });
});
