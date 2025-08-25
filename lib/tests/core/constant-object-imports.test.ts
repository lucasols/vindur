import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('constant object imports', () => {
  test('should import simple object and use its properties in css', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { mq } from '#/media-queries'

        const style = css\`
          color: red;
          \${mq.mobile} {
            color: blue;
          }
        \`
      `,

      overrideDefaultFs: createFsMock({
        'media-queries.ts': dedent`
          export const mq = {
            mobile: '@media (max-width: 768px)',
            tablet: '@media (min-width: 769px) and (max-width: 1024px)',
            desktop: '@media (min-width: 1025px)'
          }
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
        @media (max-width: 768px) {
          color: blue;
        }
      }
      "
    `);
  });

  test('should import object and use multiple properties in css', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { mq } from '#/media-queries'

        const style = css\`
          color: red;
          \${mq.mobile} {
            font-size: 14px;
          }
          \${mq.desktop} {
            font-size: 16px;
          }
        \`
      `,

      overrideDefaultFs: createFsMock({
        'media-queries.ts': dedent`
          export const mq = {
            mobile: '@media (max-width: 768px)',
            tablet: '@media (min-width: 769px) and (max-width: 1024px)',
            desktop: '@media (min-width: 1025px)'
          }
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
        @media (max-width: 768px) {
          font-size: 14px;
        }
        @media (min-width: 1025px) {
          font-size: 16px;
        }
      }
      "
    `);
  });

  test('should import object and use properties in styled components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { mq } from '#/media-queries'

        const Button = styled.button\`
          padding: 10px 20px;
          \${mq.mobile} {
            padding: 5px 10px;
          }
        \`

        const App = () => <Button>Click me</Button>
      `,

      overrideDefaultFs: createFsMock({
        'media-queries.ts': dedent`
          export const mq = {
            mobile: '@media (max-width: 768px)',
            tablet: '@media (min-width: 769px) and (max-width: 1024px)',
            desktop: '@media (min-width: 1025px)'
          }
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <button className="v1560qbr-1-Button">Click me</button>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 10px 20px;
        @media (max-width: 768px) {
          padding: 5px 10px;
        }
      }
      "
    `);
  });

  test('should import object with CSS properties and use in css', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { colors } from '#/theme'

        const style = css\`
          background-color: \${colors.primary};
          color: \${colors.white};
          border: 1px solid \${colors.border};
        \`
      `,

      overrideDefaultFs: createFsMock({
        'theme.ts': dedent`
          export const colors = {
            primary: '#007bff',
            secondary: '#6c757d',
            white: '#ffffff',
            black: '#000000',
            border: '#dee2e6'
          }
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        background-color: #007bff;
        color: #ffffff;
        border: 1px solid #dee2e6;
      }
      "
    `);
  });

  test('should import multiple objects from same file', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { colors, spacing } from '#/theme'

        const style = css\`
          background: \${colors.primary};
          padding: \${spacing.large};
          margin: \${spacing.small};
        \`
      `,

      overrideDefaultFs: createFsMock({
        'theme.ts': dedent`
          export const colors = {
            primary: '#007bff',
            secondary: '#6c757d'
          }

          export const spacing = {
            small: '8px',
            medium: '16px',
            large: '24px'
          }
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        background: #007bff;
        padding: 24px;
        margin: 8px;
      }
      "
    `);
  });

  test('should work with object properties containing special characters', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { selectors } from '#/css-utils'

        const style = css\`
          \${selectors.hover} {
            color: blue;
          }
          \${selectors.focus} {
            outline: 2px solid red;
          }
        \`
      `,

      overrideDefaultFs: createFsMock({
        'css-utils.ts': dedent`
          export const selectors = {
            hover: '&:hover',
            focus: '&:focus',
            active: '&:active',
            disabled: '&:disabled'
          }
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        &:hover {
          color: blue;
        }
        &:focus {
          outline: 2px solid red;
        }
      }
      "
    `);
  });

  test('should import object and use properties in css prop', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { mq } from '#/media-queries'

        const App = () => (
          <div css={\`
            padding: 16px;
            background: white;
            \${mq.mobile} {
              padding: 8px;
              background: lightgray;
            }
            \${mq.desktop} {
              padding: 24px;
            }
          \`}>
            Content
          </div>
        )
      `,

      overrideDefaultFs: createFsMock({
        'media-queries.ts': dedent`
          export const mq = {
            mobile: '@media (max-width: 768px)',
            tablet: '@media (min-width: 769px) and (max-width: 1024px)',
            desktop: '@media (min-width: 1025px)'
          }
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <div className="v1560qbr-1-css-prop-1">Content</div>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-css-prop-1 {
        padding: 16px;
        background: white;
        @media (max-width: 768px) {
          padding: 8px;
          background: lightgray;
        }
        @media (min-width: 1025px) {
          padding: 24px;
        }
      }
      "
    `);
  });

  test('should throw error for nested property access', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'
          import { theme } from '#/theme'

          const style = css\`
            color: \${theme.colors.primary};
          \`
        `,

        overrideDefaultFs: createFsMock({
          'theme.ts': dedent`
            export const theme = {
              colors: {
                primary: '#007bff',
                secondary: '#6c757d'
              }
            }
          `,
        }),
      }),
    ).rejects.toThrow(
      'Nested property access is not supported, only one level property access is allowed',
    );
  });

  test('should throw error for deeply nested property access', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'
          import { config } from '#/config'

          const style = css\`
            margin: \${config.theme.spacing.large};
          \`
        `,

        overrideDefaultFs: createFsMock({
          'config.ts': dedent`
            export const config = {
              theme: {
                spacing: {
                  large: '24px'
                }
              }
            }
          `,
        }),
      }),
    ).rejects.toThrow(
      'Nested property access is not supported, only one level property access is allowed',
    );
  });

  test('should throw error for nested property access in styled components', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'
          import { theme } from '#/theme'

          const Button = styled.button\`
            background: \${theme.colors.primary};
          \`
        `,

        overrideDefaultFs: createFsMock({
          'theme.ts': dedent`
            export const theme = {
              colors: {
                primary: '#007bff'
              }
            }
          `,
        }),
      }),
    ).rejects.toThrow(
      'Nested property access is not supported, only one level property access is allowed',
    );
  });
});
