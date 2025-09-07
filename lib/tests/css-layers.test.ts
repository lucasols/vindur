import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from './testUtils';

describe('CSS layers with layer() function', () => {
  test('should wrap styled component styles in multiple @layer blocks', async () => {
    const source = dedent`
      import { styled, layer } from 'vindur'

      const Card = styled.div\`
        \${layer('higher-priority')} {
          background: white;
          padding: 20px;
          border-radius: 8px;
        }

        \${layer('lower-priority')} {
          background: red;
        }
      \`

      const Component = () => {
        return <Card>Content</Card>;
      }
    `;

    const result = await transformWithFormat({ source });

    expect(result.css).toMatchInlineSnapshot(`
      "@layer higher-priority {
        .v1560qbr-1-Card {
          background: white;
          padding: 20px;
          border-radius: 8px;
        }
      }

      @layer lower-priority {
        .v1560qbr-1-Card {
          background: red;
        }
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return <div className="v1560qbr-1-Card">Content</div>;
      };
      "
    `);
  });

  test('should support mixed layered and non-layered styles', async () => {
    const source = dedent`
      import { styled, layer } from 'vindur'

      const Button = styled.button\`
        /* Non-layered base styles */
        display: inline-block;
        border: none;
        cursor: pointer;

        \${layer('theme')} {
          background: blue;
          color: white;
          padding: 8px 16px;
        }

        /* Non-layered hover state */
        &:hover {
          opacity: 0.9;
        }

        \${layer('overrides')} {
          font-weight: bold;
        }
      \`
    `;

    const result = await transformWithFormat({ source });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        /* Non-layered base styles */
        display: inline-block;
        border: none;
        cursor: pointer;
      }

      @layer theme {
        .v1560qbr-1-Button {
          background: blue;
          color: white;
          padding: 8px 16px;
        }
      }

      .v1560qbr-1-Button {
        /* Non-layered hover state */
        &:hover {
          opacity: 0.9;
        }
      }

      @layer overrides {
        .v1560qbr-1-Button {
          font-weight: bold;
        }
      }
      "
    `);
  });

  test('should work with css tagged template', async () => {
    const source = dedent`
      import { css, layer } from 'vindur'

      const styles = css\`
        \${layer('utilities')} {
          margin: 0 auto;
          max-width: 1200px;
        }

        \${layer('components')} {
          padding: 20px;
          background: #f5f5f5;
        }
      \`
    `;

    const result = await transformWithFormat({ source });

    expect(result.css).toMatchInlineSnapshot(`
      "@layer utilities {
        .v1560qbr-1-styles {
          margin: 0 auto;
          max-width: 1200px;
        }
      }

      @layer components {
        .v1560qbr-1-styles {
          padding: 20px;
          background: #f5f5f5;
        }
      }
      "
    `);
  });

  test('should work with nested selectors inside layer', async () => {
    const source = dedent`
      import { styled, layer } from 'vindur'

      const Nav = styled.nav\`
        \${layer('layout')} {
          display: flex;
          gap: 20px;
    
          a {
            color: blue;
            text-decoration: none;

            &:hover {
              text-decoration: underline;
            }
          }
        }
      \`
    `;

    const result = await transformWithFormat({ source });

    expect(result.css).toMatchInlineSnapshot(`
      "@layer layout {
        .v1560qbr-1-Nav {
          display: flex;
          gap: 20px;

          a {
            color: blue;
            text-decoration: none;

            &:hover {
              text-decoration: underline;
            }
          }
        }
      }
      "
    `);
  });

  test('should work with any layer name', async () => {
    const source = dedent`
      import { styled, layer } from 'vindur'

      const Card = styled.div\`
        \${layer('invalid layer name')} {
          background: white;
        }
      \`
    `;

    const result = await transformWithFormat({ source });

    expect(result.css).toMatchInlineSnapshot(`
      "@layer invalid layer name {
        .v1560qbr-1-Card {
          background: white;
        }
      }
      "
    `);
  });

  test('should require string literal for layer name', async () => {
    const source = dedent`
      import { styled, layer } from 'vindur'

      const layerName = 'theme'

      const Card = styled.div\`
        \${layer(layerName)} {
          background: white;
        }
      \`
    `;

    await expect(async () => {
      await transformWithFormat({ source });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: layer() must be called with a string literal layer name
      loc: 6:10]
    `,
    );
  });

  test('should work with global styles layer declaration', async () => {
    const source = dedent`
      import { styled, layer, createGlobalStyle } from 'vindur'

      // Define layer order globally
      const GlobalStyle = createGlobalStyle\`
        @layer lower-priority, higher-priority;
      \`

      const Card = styled.div\`
        \${layer('higher-priority')} {
          background: white;
        }

        \${layer('lower-priority')} {
          background: red;
        }
      \`
    `;

    const result = await transformWithFormat({ source });

    expect(result.css).toMatchInlineSnapshot(`
      "@layer lower-priority, higher-priority;

      @layer higher-priority {
        .v1560qbr-1-Card {
          background: white;
        }
      }

      @layer lower-priority {
        .v1560qbr-1-Card {
          background: red;
        }
      }
      "
    `);
  });
});
