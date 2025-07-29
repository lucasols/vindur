import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from './testUtils';

const importAliases = { '#/': '/' };
const emptyFs = createFsMock({});

describe('CSS layers functionality', () => {
  test('should wrap styled component in @layer', async () => {
    const source = dedent`
      import { styled, setLayer } from 'vindur'

      const Card = styled.div\`
        \${setLayer('vindur')};
  
        background: white;
        padding: 20px;
        border-radius: 8px;
      \`

      const Component = () => {
        return <Card>Content</Card>;
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      "@layer vindur {
        .v1560qbr-1-Card {
        background: white;
        padding: 20px;
        border-radius: 8px;
      }
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return <div className="v1560qbr-1-Card">Content</div>;
      };
      "
    `);
  });

  test('should wrap css variable in @layer', async () => {
    const source = dedent`
      import { css, setLayer } from 'vindur'

      const styles = css\`
        \${setLayer('components')};
  
        color: red;
        font-size: 16px;
      \`

      const Component = () => {
        return <div className={styles}>Text</div>;
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      "@layer components {
        .v1560qbr-1-styles {
        color: red;
        font-size: 16px;
      }
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-1-styles";
      const Component = () => {
        return <div className={styles}>Text</div>;
      };
      "
    `);
  });

  test('should wrap keyframes in @layer', async () => {
    const source = dedent`
      import { keyframes, setLayer } from 'vindur'

      const fadeIn = keyframes\`
        \${setLayer('animations')};
  
        from { opacity: 0; }
        to { opacity: 1; }
      \`

      const Component = () => {
        return <div style={{ animation: \`\${fadeIn} 1s ease-in\` }}>Content</div>;
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1560qbr-1-fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const fadeIn = "v1560qbr-1-fadeIn";
      const Component = () => {
        return (
          <div
            style={{
              animation: \`\${fadeIn} 1s ease-in\`,
            }}
          >
            Content
          </div>
        );
      };
      "
    `);
  });

  test('should not wrap global styles in @layer', async () => {
    const source = dedent`
      import { createGlobalStyle, setLayer } from 'vindur'

      createGlobalStyle\`
        \${setLayer('reset')};
  
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
      \`
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      "* {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      ""
    `);
  });

  test('should wrap styled extension in @layer', async () => {
    const source = dedent`
      import { styled, setLayer } from 'vindur'

      const BaseButton = styled.button\`
        padding: 8px 16px;
        border: none;
      \`

      const PrimaryButton = styled(BaseButton)\`
        \${setLayer('theme')};
  
        background: blue;
        color: white;
      \`

      const Component = () => {
        return <PrimaryButton>Click me</PrimaryButton>;
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-BaseButton {
        padding: 8px 16px;
        border: none;
      }

      @layer theme {
        .v1560qbr-2-PrimaryButton {
        background: blue;
        color: white;
      }
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return (
          <button className="v1560qbr-1-BaseButton v1560qbr-2-PrimaryButton">
            Click me
          </button>
        );
      };
      "
    `);
  });

  test('should validate layer name', async () => {
    const source = dedent`
      import { styled, setLayer } from 'vindur'

      const Card = styled.div\`
        \${setLayer('invalid layer name')};
        background: white;
      \`
    `;

    await expect(async () => {
      await transformWithFormat({
        source,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: Invalid layer name "invalid layer name". Layer names must be valid CSS identifiers]`,
    );
  });

  test('should require string literal for layer name', async () => {
    const source = dedent`
      import { styled, setLayer } from 'vindur'

      const layerName = 'vindur'

      const Card = styled.div\`
        \${setLayer(layerName)};
        background: white;
      \`
    `;

    await expect(async () => {
      await transformWithFormat({
        source,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: setLayer() must be called with a string literal layer name]`,
    );
  });

  test('should only allow setLayer at the top of styles', async () => {
    const source = dedent`
      import { styled, setLayer } from 'vindur'

      const Card = styled.div\`
        background: white;
        \${setLayer('vindur')};
        padding: 20px;
      \`
    `;

    await expect(async () => {
      await transformWithFormat({
        source,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: setLayer() must be called at the beginning of the template literal]`,
    );
  });

  test('should support multiple components with different layers', async () => {
    const source = dedent`
      import { styled, setLayer } from 'vindur'

      const Layout = styled.div\`
        \${setLayer('layout')};
        display: flex;
        flex-direction: column;
      \`

      const Content = styled.div\`
        \${setLayer('components')};
        padding: 20px;
        background: white;
      \`

      const Component = () => {
        return (
          <Layout>
            <Content>Hello</Content>
          </Layout>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      "@layer layout {
        .v1560qbr-1-Layout {
        display: flex;
        flex-direction: column;
      }
      }

      @layer components {
        .v1560qbr-2-Content {
        padding: 20px;
        background: white;
      }
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return (
          <div className="v1560qbr-1-Layout">
            <div className="v1560qbr-2-Content">Hello</div>
          </div>
        );
      };
      "
    `);
  });

  test('should work with components without layers', async () => {
    const source = dedent`
      import { styled, setLayer } from 'vindur'

      const WithLayer = styled.div\`
        \${setLayer('vindur')};
        color: blue;
      \`

      const WithoutLayer = styled.div\`
        color: red;
      \`

      const Component = () => {
        return (
          <div>
            <WithLayer>Blue</WithLayer>
            <WithoutLayer>Red</WithoutLayer>
          </div>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      "@layer vindur {
        .v1560qbr-1-WithLayer {
        color: blue;
      }
      }

      .v1560qbr-2-WithoutLayer {
        color: red;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return (
          <div>
            <div className="v1560qbr-1-WithLayer">Blue</div>
            <div className="v1560qbr-2-WithoutLayer">Red</div>
          </div>
        );
      };
      "
    `);
  });
});
