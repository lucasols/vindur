import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('forward references', () => {
  test('should support forward references with arrow functions', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Card = styled.div\`
          background: white;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

          \${() => Container}:hover & {
            background: #007bff;
            color: white;
          }
        \`

        const Container = styled.div\`
          background: #f5f5f5;
          padding: 20px;
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        background: white;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

        .v1560qbr-2-Container:hover & {
          background: #007bff;
          color: white;
        }
      }

      .v1560qbr-2-Container {
        background: #f5f5f5;
        padding: 20px;
      }
      "
    `);
  });

  test('should support multiple forward references', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Header = styled.header\`
          background: white;
  
          \${() => Nav} {
            background: transparent;
          }
  
          \${() => Button}:hover {
            background: #007bff;
          }
        \`

        const Nav = styled.nav\`
          display: flex;
          gap: 16px;
        \`

        const Button = styled.button\`
          padding: 8px 16px;
          border: none;
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Header {
        background: white;

        .v1560qbr-2-Nav {
          background: transparent;
        }

        .v1560qbr-3-Button:hover {
          background: #007bff;
        }
      }

      .v1560qbr-2-Nav {
        display: flex;
        gap: 16px;
      }

      .v1560qbr-3-Button {
        padding: 8px 16px;
        border: none;
      }
      "
    `);
  });

  test('should work with css function forward references', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled, css } from 'vindur'

        const containerStyles = css\`
          max-width: 1200px;
          margin: 0 auto;
  
          \${() => Card} {
            margin-bottom: 16px;
          }
        \`

        const Card = styled.div\`
          background: white;
          padding: 20px;
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const containerStyles = "v1560qbr-1-containerStyles";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-containerStyles {
        max-width: 1200px;
        margin: 0 auto;

        .v1560qbr-2-Card {
          margin-bottom: 16px;
        }
      }

      .v1560qbr-2-Card {
        background: white;
        padding: 20px;
      }
      "
    `);
  });

  test('should throw error for undefined forward reference', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Card = styled.div\`
            background: white;
  
            \${() => UndefinedComponent}:hover & {
              background: #007bff;
            }
          \`
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      'Forward reference to undefined styled component: UndefinedComponent',
    );
  });

  test('should throw error for invalid arrow function syntax', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Card = styled.div\`
            background: white;
  
            \${(props) => props.theme.primary} {
              color: red;
            }
          \`
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      'Invalid arrow function in interpolation',
    );
  });

  test('should work with nested forward references', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Wrapper = styled.div\`
          padding: 20px;
  
          \${() => Card} {
            margin: 16px 0;
    
            \${() => Button} {
              margin-top: 8px;
            }
          }
        \`

        const Card = styled.div\`
          background: white;
          border-radius: 8px;
        \`

        const Button = styled.button\`
          background: #007bff;
          color: white;
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Wrapper {
        padding: 20px;

        .v1560qbr-2-Card {
          margin: 16px 0;

          .v1560qbr-3-Button {
            margin-top: 8px;
          }
        }
      }

      .v1560qbr-2-Card {
        background: white;
        border-radius: 8px;
      }

      .v1560qbr-3-Button {
        background: #007bff;
        color: white;
      }
      "
    `);
  });
});
