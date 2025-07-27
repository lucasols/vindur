import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('Dynamic Colors - Basic Usage', () => {
  test('should transform basic dynamic color usage in styled components', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const dynamicColor = createDynamicCssColor()

      const Card = styled.div\`
        background: \${dynamicColor.var};
        color: \${dynamicColor.contrast.var};
      \`

      const Component = () => {
        return <Card dynamicColor={dynamicColor.set('#ff6b6b')}>Hello World</Card>;
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const dynamicColor = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return (
          <div
            {...dynamicColor._sp("#ff6b6b", {
              className: "v1560qbr-2",
            })}
          >
            Hello World
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
            dynamicColor={color.set('#ff6b6b')}
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
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return (
          <div
            onClick={() => console.log("clicked")}
            {...color._sp("#ff6b6b", {
              className: "v1560qbr-2 custom-card",
              style: {
                padding: "20px",
              },
            })}
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
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1");
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
      'createDynamicCssColor() should not be called with an ID parameter',
    );
  });
});
