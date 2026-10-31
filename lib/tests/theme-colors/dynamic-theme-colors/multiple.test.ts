import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../../testUtils';

describe('Dynamic Colors - Multiple Colors', () => {
  test('should transform multiple dynamic colors in JSX dynamicColor prop', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color1 = createDynamicCssColor()
      const color2 = createDynamicCssColor()

      const Card = styled.div\`
        background: \${color1.value};
        color: \${color1.contrast.value};
        border: 2px solid \${color2.value};
      \`

      const Component = () => {
        return (
          <div dynamicColor={[color1.set('#ff6b6b'), color2.set('#ff6b6b')]}>
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
      const color1 = createDynamicCssColor("v1560qbr-1-color1", true);
      const color2 = createDynamicCssColor("v1560qbr-2-color2", true);
      const Component = () => {
        return (
          <div {...color1._sp("#ff6b6b", color2._sp("#ff6b6b"))}>
            <div className="v1560qbr-3-Card">Card with multiple colors</div>
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-3-Card {
        background: var(--v1560qbr-1-color1);
        color: var(--v1560qbr-1-color1-c);
        border: 2px solid var(--v1560qbr-2-color2);
      }
      "
    `);
  });

  test('should forward set options of each color', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createDynamicCssColor } from 'vindur'

        const color1 = createDynamicCssColor()
        const color2 = createDynamicCssColor()

        const options = { veryLightThreshold: 0.9 }

        const Component = ({ color }) => {
          return (
            <div
              className="box"
              dynamicColor={[
                color1.set(color, { veryDarkThreshold: 0.12 }),
                color2.set('#ff6b6b', options),
              ]}
            />
          );
        }
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const color1 = createDynamicCssColor("v1560qbr-1-color1", true);
      const color2 = createDynamicCssColor("v1560qbr-2-color2", true);
      const options = {
        veryLightThreshold: 0.9,
      };
      const Component = ({ color }) => {
        return (
          <div
            {...color1._sp(
              color,
              color2._sp(
                "#ff6b6b",
                {
                  className: "box",
                },
                options,
              ),
              {
                veryDarkThreshold: 0.12,
              },
            )}
          />
        );
      };
      "
    `);
  });

  test('should handle multiple dynamic colors with cross-color selectors', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const primaryColor = createDynamicCssColor()
      const secondaryColor = createDynamicCssColor()

      const Card = styled.div\`
        border: 2px solid \${secondaryColor.value};

        \${primaryColor.self.isDark} {
          border-style: dashed;
        }

        \${secondaryColor.container.isLight} & {
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
      \`

      const Component = () => {
        return (
          <div dynamicColor={[primaryColor.set('#ff6b6b'), secondaryColor.set('#ff6b6b')]}>
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
      const primaryColor = createDynamicCssColor("v1560qbr-1-primaryColor", true);
      const secondaryColor = createDynamicCssColor("v1560qbr-2-secondaryColor", true);
      const Component = () => {
        return (
          <div {...primaryColor._sp("#ff6b6b", secondaryColor._sp("#ff6b6b"))}>
            <div className="v1560qbr-3-Card">
              Multiple colors with cross-references
            </div>
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-3-Card {
        border: 2px solid var(--v1560qbr-2-secondaryColor);

        &.v1560qbr-1-primaryColor-self-isDark {
          border-style: dashed;
        }

        .v1560qbr-2-secondaryColor-container-isLight & {
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
      }
      "
    `);
  });

  test('should handle multiple dynamic colors with spread props', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const primaryColor = createDynamicCssColor()
      const secondaryColor = createDynamicCssColor()

      const Card = styled.div\`
        background: \${primaryColor.value};
        border: 2px solid \${secondaryColor.value};
      \`

      const Component = () => {
        const cardProps = { 'data-testid': 'themed-card' }
        const styleProps = { style: { padding: '16px' } }
        return (
          <Card 
            {...cardProps}
            {...styleProps}
            dynamicColor={[primaryColor.set('#ff6b6b'), secondaryColor.set('#ff6b6b')]}
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
      const primaryColor = createDynamicCssColor("v1560qbr-1-primaryColor", true);
      const secondaryColor = createDynamicCssColor("v1560qbr-2-secondaryColor", true);
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
            onClick={() => console.log("clicked")}
            {...primaryColor._sp(
              "#ff6b6b",
              secondaryColor._sp("#ff6b6b", {
                className: mergeClassNames(
                  [cardProps, styleProps],
                  "v1560qbr-3-Card",
                ),
                style: mergeStyles([cardProps, styleProps]),
              }),
            )}
          >
            Multi-color card
          </div>
        );
      };
      "
    `);
  });
});

test('should throw for more than one setColorScheme in a dynamicColor array', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createDynamicCssColor } from 'vindur'

        const bg = createDynamicCssColor()
        const border = createDynamicCssColor()

        const Component = ({ color }) => (
          <div
            dynamicColor={[
              bg.set(color, { setColorScheme: { fallback: 'dark' } }),
              border.set('#000', { setColorScheme: { fallback: 'light' } }),
            ]}
          />
        )
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Only one color in a dynamicColor array can use setColorScheme, the element can only have one color scheme. Remove setColorScheme from the other colors
    loc: 10:25]
  `);
});

test('should allow setColorScheme on one color of a dynamicColor array', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur'

      const bg = createDynamicCssColor()
      const border = createDynamicCssColor()

      const Component = ({ color }) => (
        <div
          dynamicColor={[
            bg.set(color, { setColorScheme: { fallback: 'dark' } }),
            border.set('#000', { veryDarkThreshold: 0.1 }),
          ]}
        />
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const bg = createDynamicCssColor("v1560qbr-1-bg", true);
    const border = createDynamicCssColor("v1560qbr-2-border", true);
    const Component = ({ color }) => (
      <div
        {...bg._sp(
          color,
          border._sp("#000", undefined, {
            veryDarkThreshold: 0.1,
          }),
          {
            setColorScheme: {
              fallback: "dark",
            },
          },
        )}
      />
    );
    "
  `);
});
