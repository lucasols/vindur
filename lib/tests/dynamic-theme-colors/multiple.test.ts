import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('Dynamic Colors - Multiple Colors', () => {
  test('should transform multiple dynamic colors in JSX dynamicColor prop', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color1 = createDynamicCssColor()
      const color2 = createDynamicCssColor()

      const Card = styled.div\`
        background: \${color1.var};
        color: \${color1.contrast.var};
        border: 2px solid \${color2.var};
      \`

      const Component = () => {
        return (
          <div dynamicColor={[color1, color2]}>
            <Card>Card with multiple colors</Card>
          </div>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const color1 = createDynamicCssColor("v1560qbr-1");
      const color2 = createDynamicCssColor("v1560qbr-2");
      const Component = () => {
        return (
          <div {...color1.setProps("#ff6b6b", color2.setProps("#ff6b6b"))}>
            <div className="v1560qbr-3">Card with multiple colors</div>
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-3 {
        background: var(--v1560qbr-1);
        color: var(--v1560qbr-1-c);
        border: 2px solid var(--v1560qbr-2);
      }"
    `);
  });

  test('should handle multiple dynamic colors with cross-color selectors', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const primaryColor = createDynamicCssColor()
      const secondaryColor = createDynamicCssColor()

      const Card = styled.div\`
        border: 2px solid \${secondaryColor.var};

        \${primaryColor.self.isDark} {
          border-style: dashed;
        }

        \${secondaryColor.container.isLight} & {
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
      \`

      const Component = () => {
        return (
          <div dynamicColor={[primaryColor, secondaryColor]}>
            <Card>Multiple colors with cross-references</Card>
          </div>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const primaryColor = createDynamicCssColor("v1560qbr-1");
      const secondaryColor = createDynamicCssColor("v1560qbr-2");
      const Component = () => {
        return (
          <div
            {...primaryColor.setProps("#ff6b6b", secondaryColor.setProps("#ff6b6b"))}
          >
            <div className="v1560qbr-3">Multiple colors with cross-references</div>
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-3 {
        border: 2px solid var(--v1560qbr-2);

        &.v1560qbr-1-s0 {
          border-style: dashed;
        }

        .v1560qbr-2-c1 & {
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
      }"
    `);
  });

  test('should handle multiple dynamic colors with spread props', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const primaryColor = createDynamicCssColor()
      const secondaryColor = createDynamicCssColor()

      const Card = styled.div\`
        background: \${primaryColor.var};
        border: 2px solid \${secondaryColor.var};
      \`

      const Component = () => {
        const cardProps = { 'data-testid': 'themed-card' }
        const styleProps = { style: { padding: '16px' } }
        return (
          <Card 
            {...cardProps}
            {...styleProps}
            dynamicColor={[primaryColor, secondaryColor]}
            onClick={() => console.log('clicked')}
          >
            Multi-color card
          </Card>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor, mergeClassNames, mergeStyles } from "vindur";
      const primaryColor = createDynamicCssColor("v1560qbr-1");
      const secondaryColor = createDynamicCssColor("v1560qbr-2");
      const Component = () => {
        const cardProps = {
          "data-testid": "themed-card",
        };
        const styleProps = {
          style: {
            padding: "16px",
          },
        };
        return (
          <div
            {...cardProps}
            {...styleProps}
            {...primaryColor.setProps(
              "#ff6b6b",
              secondaryColor.setProps("#ff6b6b", {
                className: mergeClassNames([cardProps, styleProps], "v1560qbr-3"),
              }),
            )}
            onClick={() => console.log("clicked")}
          >
            Multi-color card
          </div>
        );
      };
      "
    `);
  });
});
