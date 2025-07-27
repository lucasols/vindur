import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from './testUtils';

describe('createDynamicCssColor', () => {
  test('should transform basic dynamic color usage in styled components', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const dynamicColor = createDynamicCssColor()

      const Card = styled.div\`
        background: \${dynamicColor.var};
        color: \${dynamicColor.contrast.var};
      \`

      const Component = () => {
        return <Card dynamicColor={dynamicColor}>Hello World</Card>;
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      import { createDynamicCssColor } from 'vindur'

      "const dynamicColor = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return <div {...dynamicColor.setProps("#ff6b6b", {
          className: "v1560qbr-2",
        })}>Hello World</div>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2 {
        background: var(--v1560qbr-1);
        color: var(--v1560qbr-1-c);
      }"
    `);
  });

  test('should transform basic dynamic color usage with dev mode selectors', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const dynamicColor = createDynamicCssColor()

      const Container = styled.div\`
        background: \${dynamicColor.var};
        color: \${dynamicColor.contrast.var};

        \${dynamicColor.self.isDark} {
          border: 2px solid white;
        }

        \${dynamicColor.self.isLight} {
          border: 2px solid black;
        }
      \`

      const Component = () => {
        return (
          <div dynamicColor={dynamicColor}>
            <Container>Dev mode content</Container>
          </div>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
      dev: true,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const dynamicColor = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return (
          <div {...dynamicColor.setProps("#ff6b6b", {})}>
            <div className="v1560qbr-2-Container">Dev mode content</div>
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-Container {
        background: var(--v1560qbr-1);
        color: var(--v1560qbr-1-c);

        &.v1560qbr-1-self-is-dark {
          border: 2px solid white;
        }

        &.v1560qbr-1-self-is-light {
          border: 2px solid black;
        }
      }"
    `);
  });

  test('should transform dynamic color with color manipulation functions', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Button = styled.button\`
        background: \${color.var};
        color: \${color.contrast.var};

        --darker: \${color.darker(0.1)};
        --alpha: \${color.alpha(0.8)};
        --lighter: \${color.lighter(0.3)};
        --contrast-alpha: \${color.contrast.alpha(0.6)};
        --contrast-optimal: \${color.contrast.optimal()};
        --contrast-optimal-alpha: \${color.contrast.optimal({ alpha: 0.6 })};
        --saturated-darker: \${color.saturatedDarker(0.1)};
      \`

      const Component = () => {
        return <Button dynamicColor={color}>Click me</Button>;
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return <button {...color.setProps("#ff6b6b", {
          className: "v1560qbr-2",
        })}>Click me</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2 {
        background: var(--v1560qbr-1);
        color: var(--v1560qbr-1-c);

        --darker: color-mix(in srgb, var(--v1560qbr-1) 90%, #000);
        --alpha: color-mix(in srgb, var(--v1560qbr-1) 80%, transparent);
        --lighter: color-mix(in srgb, var(--v1560qbr-1) 70%, #fff);
        --contrast-alpha: color-mix(in srgb, var(--v1560qbr-1-c) 60%, transparent);
        --contrast-optimal: var(--v1560qbr-1-c-optimal);
        --contrast-optimal-alpha: color-mix(in srgb, var(--v1560qbr-1-c-optimal) 60%, transparent);
        --saturated-darker: color-mix(in srgb, var(--v1560qbr-1) 90%, hsl(from var(--v1560qbr-1) h 100% 20%));
      }"
    `);
  });

  test('should transform container conditional selectors', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Card = styled.div\`
        background: white;
        padding: 20px;

        \${color.container.isLight} & {
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        \${color.container.isDark} & {
          box-shadow: 0 2px 8px rgba(255,255,255,0.1);
        }

        \${color.container.isDefined} & {
          border-radius: 8px;
        }

        \${color.container.isNotDefined} & {
          border: 1px solid #ccc;
        }
      \`

      const Component = () => {
        return (
          <div dynamicColor={color}>
            <Card>Card content</Card>
          </div>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return (
          <div {...color.setProps("#ff6b6b")}>
            <div className="v1560qbr-2">Card content</div>
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2 {
        background: white;
        padding: 20px;

        .v1560qbr-1-c1 & {
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .v1560qbr-1-c0 & {
          box-shadow: 0 2px 8px rgba(255,255,255,0.1);
        }

        .v1560qbr-1-c2 & {
          border-radius: 8px;
        }

        .v1560qbr-1-c3 & {
          border: 1px solid #ccc;
        }
      }"
    `);
  });

  test('should transform dynamic color in CSS function', async () => {
    const source = dedent`
      import { createDynamicCssColor, css } from 'vindur'

      const color = createDynamicCssColor()

      const cardStyles = css\`
        background: \${color.var};
        color: \${color.contrast.var};
        padding: 20px;
        border-radius: 8px;

        \${color.self.isDark} {
          border: 1px solid \${color.lighter(0.2)};
        }
      \`

      const Component = () => {
        return <div className={cardStyles} dynamicColor={color}>Styled with CSS</div>;
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const color = createDynamicCssColor("v1560qbr-1");
      const cardStyles = "v1560qbr-2";
      const Component = () => {
        return <div {...color.setProps("#ff6b6b", {
          className: cardStyles
        })}>Styled with CSS</div>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2 {
        background: var(--v1560qbr-1);
        color: var(--v1560qbr-1-c);
        padding: 20px;
        border-radius: 8px;

        &.v1560qbr-1-s0 {
          border: 1px solid color-mix(in srgb, var(--v1560qbr-1) 80%, #fff);
        }
      }"
    `);
  });

  test('should transform dynamic color with dynamicColor prop and additional props', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Card = styled.div\`
        background: \${color.var};
        color: \${color.contrast.var};
      \`

      const Component = () => {
        return (
          <Card 
            dynamicColor={color}
            style={{ padding: '20px' }}
            className="custom-card"
            onClick={() => console.log('clicked')}
          >
            Card with dynamic color and additional props
          </Card>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return (
          <div 
            {...color.setProps("#ff6b6b", {
              style: { padding: "20px" },
              className: "custom-card v1560qbr-2"
            })}
            onClick={() => console.log("clicked")}
          >
            Card with dynamic color and additional props
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2 {
        background: var(--v1560qbr-1);
        color: var(--v1560qbr-1-c);
      }"
    `);
  });

  test('should not transform when using setProps directly', async () => {
    const source = dedent`
      import { createDynamicCssColor } from 'vindur'

      const color = createDynamicCssColor()

      const Component = () => {
        return (
          <div 
            {...color.setProps('#007bff', { 
              style: { padding: '20px' },
              className: 'custom-card' 
            })}
            onClick={() => console.log('clicked')}
          >
            Direct setProps usage - no transformation
          </div>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return (
          <div
            {...color.setProps("#007bff", {
              style: {
                padding: "20px",
              },
              className: "custom-card",
            })}
            onClick={() => console.log("clicked")}
          >
            Direct setProps usage - no transformation
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

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
      "const color1 = createDynamicCssColor("v1560qbr-1");
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

  test('should transform imported dynamic color', async () => {
    const fs = createFsMock({
      'colors.ts': dedent`
        import { createDynamicCssColor } from 'vindur'

        export const themeColor = createDynamicCssColor()
      `,
    });

    const source = dedent`
      import { styled } from 'vindur'
      import { themeColor } from '#/colors'

      const Button = styled.button\`
        background: \${themeColor.var};
        color: \${themeColor.contrast.var};

        \${themeColor.self.isDark} {
          border: 1px solid white;
        }

        \${themeColor.container.isLight} & {
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
      \`

      const Component = () => {
        return <Button dynamicColor={themeColor}>Import test</Button>;
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: fs,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return <button {...themeColor.setProps("#ff6b6b", {
          className: "v1560qbr-1",
        })}>Import test</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: var(--v1560qbr-2);
        color: var(--v1560qbr-2-c);

        &.v1560qbr-2-s-dark {
          border: 1px solid white;
        }

        .v1560qbr-2-c-light & {
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
      }"
    `);
  });

  test('should transform dynamic color with all conditional selectors', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const ComplexComponent = styled.div\`
        background: \${color.var};

        \${color.self.isDark} {
          color: white;
        }

        \${color.self.isLight} {
          color: black;
        }

        \${color.self.isDefined} {
          border: 1px solid;
        }

        \${color.self.isNotDefined} {
          border: 1px dashed #ccc;
        }

        \${color.self.isVeryDark} {
          font-weight: bold;
        }

        \${color.self.isNotVeryDark} {
          font-weight: normal;
        }

        \${color.self.isVeryLight} {
          text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
        }

        \${color.self.isNotVeryLight} {
          text-shadow: none;
        }
      \`

      const Component = () => {
        return <ComplexComponent dynamicColor={color}>All selectors test</ComplexComponent>;
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return <div {...color.setProps("#ff6b6b", {
          className: "v1560qbr-2",
        })}>All selectors test</div>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2 {
        background: var(--v1560qbr-1);

        &.v1560qbr-1-s0 {
          color: white;
        }

        &.v1560qbr-1-s1 {
          color: black;
        }

        &.v1560qbr-1-s2 {
          border: 1px solid;
        }

        &.v1560qbr-1-s3 {
          border: 1px dashed #ccc;
        }

        &.v1560qbr-1-s4 {
          font-weight: bold;
        }

        &.v1560qbr-1-s5 {
          font-weight: normal;
        }

        &.v1560qbr-1-s6 {
          text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
        }

        &.v1560qbr-1-s7 {
          text-shadow: none;
        }
      }"
    `);
  });

  test('should transform mixed self and container selectors in nested elements', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Card = styled.div\`
        padding: 20px;

        .title {
          font-size: 24px;

          \${color.container.isLight} & {
            color: #333;
          }

          \${color.container.isDark} & {
            color: #fff;
          }
        }

        .content {
          margin-top: 16px;

          \${color.container.isDefined} & {
            opacity: 1;
          }

          \${color.container.isNotDefined} & {
            opacity: 0.7;
          }
        }
      \`

      const Component = () => {
        return (
          <div dynamicColor={color}>
            <Card>
              <div className="title">Title</div>
              <div className="content">Content</div>
            </Card>
          </div>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return (
          <div {...color.setProps("#ff6b6b")}>
            <div className="v1560qbr-2">
              <div className="title">Title</div>
              <div className="content">Content</div>
            </div>
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2 {
        padding: 20px;

        .title {
          font-size: 24px;

          .v1560qbr-1-c1 & {
            color: #333;
          }

          .v1560qbr-1-c0 & {
            color: #fff;
          }
        }

        .content {
          margin-top: 16px;

          .v1560qbr-1-c2 & {
            opacity: 1;
          }

          .v1560qbr-1-c3 & {
            opacity: 0.7;
          }
        }
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
      "const primaryColor = createDynamicCssColor("v1560qbr-1");
      const secondaryColor = createDynamicCssColor("v1560qbr-2");
      const Component = () => {
        return (
          <div dynamicColor={[primaryColor, secondaryColor]}>
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

  test('should throw error when ID is manually passed to createDynamicCssColor', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor('custom-id')

      const Button = styled.button\`
        background: \${color.var};
      \`

      const Component = () => {
        return <Button dynamicColor={color}>Button</Button>;
      }
    `;

    await expect(transformWithFormat({ source })).rejects.toThrow(
      'createDynamicCssColor() should not be called with an ID parameter. The ID is automatically generated by the compiler.',
    );
  });
});
