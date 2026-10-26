import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../../testUtils';

describe('Dynamic Colors - Color Manipulation Functions', () => {
  test('should transform dynamic color with color manipulation functions', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Button = styled.button\`
        background: \${color.value};
        color: \${color.contrast.value};

        --darker: \${color.darker(0.1)};
        --alpha: \${color.alpha(0.8)};
        --lighter: \${color.lighter(0.3)};
        --contrast-alpha: \${color.contrast.alpha(0.6)};
        --contrast-optimal: \${color.contrast.optimal()};
        --contrast-optimal-alpha: \${color.contrast.optimal({ alpha: 0.6 })};
        --saturated-darker: \${color.saturatedDarker(0.1)};
      \`

      const Component = () => {
        return <Button dynamicColor={color.set('#ff6b6b')}>Click me</Button>;
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1-color", true);
      const Component = () => {
        return (
          <button
            {...color._sp("#ff6b6b", {
              className: "v1560qbr-2-Button",
            })}
          >
            Click me
          </button>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-Button {
        background: var(--v1560qbr-1-color);
        color: var(--v1560qbr-1-color-c);

        --darker: color-mix(in srgb, var(--v1560qbr-1-color) 90%, #000);
        --alpha: color-mix(in srgb, var(--v1560qbr-1-color) 80%, transparent);
        --lighter: color-mix(in srgb, var(--v1560qbr-1-color) 70%, #fff);
        --contrast-alpha: color-mix(
          in srgb,
          var(--v1560qbr-1-color-c) 60%,
          transparent
        );
        --contrast-optimal: var(--v1560qbr-1-color-c-optimal);
        --contrast-optimal-alpha: color-mix(
          in srgb,
          var(--v1560qbr-1-color-c-optimal) 60%,
          transparent
        );
        --saturated-darker: hsl(
          var(--v1560qbr-1-color-h),
          var(--v1560qbr-1-color-sds),
          calc(var(--v1560qbr-1-color-l) * 0.9)
        );
      }
      "
    `);
  });
});
