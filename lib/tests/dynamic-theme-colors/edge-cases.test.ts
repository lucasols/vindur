import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('Dynamic Colors - Edge Cases', () => {
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
        return (
          <button
            {...themeColor.setProps("#ff6b6b", {
              className: "v1560qbr-1",
            })}
          >
            Import test
          </button>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: var(--v1560qbr-2);
        color: var(--v1560qbr-2-c);

        &.v1560qbr-2-s0 {
          border: 1px solid white;
        }

        .v1560qbr-2-c1 & {
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
      }"
    `);
  });
});
