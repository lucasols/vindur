import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('Dynamic Colors - Color Manipulation Functions', () => {
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
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return (
          <button
            {...color.setProps("#ff6b6b", {
              className: "v1560qbr-2",
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
});
