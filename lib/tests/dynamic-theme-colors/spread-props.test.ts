import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('Dynamic Colors - Spread Props', () => {
  test('should handle dynamic color with spread props', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Button = styled.button\`
        background: \${color.var};
        color: \${color.contrast.var};
      \`

      const Component = () => {
        const buttonProps = { onClick: () => {}, disabled: false }
        return <Button {...buttonProps} dynamicColor={color}>Click me</Button>;
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor, mergeClassNames, mergeStyles } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        const buttonProps = {
          onClick: () => {},
          disabled: false,
        };
        return (
          <button
            {...buttonProps}
            {...color._sp("#ff6b6b", {
              className: mergeClassNames([buttonProps], "v1560qbr-2"),
              style: mergeStyles([buttonProps]),
            })}
          >
            Click me
          </button>
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

  test('should handle dynamic color with multiple spread props', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Card = styled.div\`
        background: \${color.var};
        padding: 20px;
      \`

      const Component = () => {
        const styleProps = { style: { margin: '10px' } }
        const eventProps = { onClick: () => {}, onMouseOver: () => {} }
        return (
          <Card 
            {...styleProps}
            {...eventProps}
            dynamicColor={color.set('#ff6b6b')}
            id="card"
          >
            Content
          </Card>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor, mergeClassNames, mergeStyles } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        const styleProps = {
          style: {
            margin: "10px",
          },
        };
        const eventProps = {
          onClick: () => {},
          onMouseOver: () => {},
        };
        return (
          <div
            {...styleProps}
            {...eventProps}
            id="card"
            {...color._sp("#ff6b6b", {
              className: mergeClassNames([styleProps, eventProps], "v1560qbr-2"),
              style: mergeStyles([styleProps, eventProps]),
            })}
          >
            Content
          </div>
        );
      };
      "
    `);
  });

  test('should handle dynamic color with spread props and additional className overriding the spreads', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Box = styled.div\`
        background: \${color.var};
      \`

      const Component = () => {
        const boxProps = { className: 'flex-item' }
        const dataProps = { 'data-component': 'themed-box' }
        return (
          <Box 
            className="initial-class"
            {...boxProps}
            {...dataProps}
            dynamicColor={color.set('#ff6b6b')}
            className="final-class"
          >
            Box content
          </Box>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        const boxProps = {
          className: "flex-item",
        };
        const dataProps = {
          "data-component": "themed-box",
        };
        return (
          <div
            {...boxProps}
            {...dataProps}
            {...color._sp("#ff6b6b", { className: "final-class" })}
          >
            Box content
          </div>
        );
      };
      "
    `);
  });

  test('should handle dynamic color with spread props and style overriding the spreads', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Card = styled.div\`
        background: \${color.var};
        padding: 20px;
      \`

      const Component = () => {
        const styleProps = { style: { margin: '10px' } }
        const otherProps = { className: 'base-card' }
        return (
          <Card 
            style={{ borderRadius: '4px' }}
            {...styleProps}
            {...otherProps}
            dynamicColor={color.set('#ff6b6b')}
            style={{ padding: '30px', fontSize: '14px' }}
          >
            Content with overridden styles
          </Card>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        const styleProps = {
          style: {
            margin: "10px",
          },
        };
        const otherProps = {
          className: "base-card",
        };
        return (
          <div
            {...styleProps}
            {...otherProps}
            {...color._sp("#ff6b6b", {
              className: "v1560qbr-2",
              style: { padding: "30px", fontSize: "14px" },
            })}
          >
            Content with overridden styles
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2 {
        background: var(--v1560qbr-1);
        padding: 20px;
      }"
    `);
  });

  test('should handle dynamic color with event handlers in spread props', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const InteractiveButton = styled.button\`
        background: \${color.var};
        color: \${color.contrast.var};
      \`

      const Component = () => {
        const eventHandlers = {
          onClick: (e) => console.log('clicked', e),
          onMouseEnter: () => console.log('mouse enter'),
          onFocus: () => console.log('focused')
        }
        const accessibilityProps = {
          'aria-label': 'Interactive themed button',
          tabIndex: 0
        }
        return (
          <InteractiveButton 
            {...eventHandlers}
            {...accessibilityProps}
            dynamicColor={color.set('#ff6b6b')}
            type="button"
          >
            Interactive Button
          </InteractiveButton>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor, mergeClassNames, mergeStyles } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        const eventHandlers = {
          onClick: (e) => console.log("clicked", e),
          onMouseEnter: () => console.log("mouse enter"),
          onFocus: () => console.log("focused"),
        };
        const accessibilityProps = {
          "aria-label": "Interactive themed button",
          tabIndex: 0,
        };
        return (
          <button
            {...eventHandlers}
            {...accessibilityProps}
            type="button"
            {...color._sp("#ff6b6b", {
              className: mergeClassNames([eventHandlers, accessibilityProps], "v1560qbr-2"),
              style: mergeStyles([eventHandlers, accessibilityProps]),
            })}
          >
            Interactive Button
          </button>
        );
      };
      "
    `);
  });
});
