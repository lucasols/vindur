import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('Dynamic Colors - CSS Function Usage', () => {
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
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1");
      const cardStyles = "v1560qbr-2";
      const Component = () => {
        return (
          <div
            {...color._sp("#ff6b6b", {
              className: cardStyles,
            })}
          >
            Styled with CSS
          </div>
        );
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

  test('should handle dynamic color in css function with spread props and override className and style', async () => {
    const source = dedent`
      import { createDynamicCssColor, css } from 'vindur'

      const color = createDynamicCssColor()

      const cardStyles = css\`
        background: \${color.var};
        color: \${color.contrast.var};
        padding: 20px;
      \`

      const Component = () => {
        const divProps = { 
          'data-version': '2.0',
          role: 'article' 
        }
        return (
          <div 
            {...divProps}
            className={cardStyles}
            style={{
              padding: '10px',
            }}
            dynamicColor={color}
          >
            Styled with CSS
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
      const cardStyles = "v1560qbr-2";
      const Component = () => {
        const divProps = {
          "data-version": "2.0",
          role: "article",
        };
        return (
          <div
            {...divProps}
            {...color._sp("#ff6b6b", {
              className: cardStyles,
              style: {
                padding: "10px",
              },
            })}
          >
            Styled with CSS
          </div>
        );
      };
      "
    `);
  });
});
