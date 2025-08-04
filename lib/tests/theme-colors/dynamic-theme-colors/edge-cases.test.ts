import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../../testUtils';

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
        return <Button dynamicColor={themeColor.set('#ff6b6b')}>Import test</Button>;
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
            {...themeColor._sp("#ff6b6b", {
              className: "v1560qbr-1-Button",
            })}
          >
            Import test
          </button>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: var(--v1560qbr-2);
        color: var(--v1560qbr-2-c);

        &.v1560qbr-2-s0 {
          border: 1px solid white;
        }

        .v1560qbr-2-c1 & {
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
      }
      "
    `);
  });

  test('should handle conditional set inside the set function', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const StyledButton = styled.button\`
        background: \${color.var};
        color: \${color.contrast.var};
      \`

      const Component = ({ condition }) => {
        return (
          <StyledButton dynamicColor={color.set(condition ? '#ff6b6b' : null)}>
            Conditional Color
          </StyledButton>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1", true);
      const Component = ({ condition }) => {
        return (
          <button
            {...color._sp(condition ? "#ff6b6b" : null, {
              className: "v1560qbr-2-StyledButton",
            })}
          >
            Conditional Color
          </button>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-StyledButton {
        background: var(--v1560qbr-1);
        color: var(--v1560qbr-1-c);
      }
      "
    `);
  });

  test('should handle conditional set with undefined', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const StyledButton = styled.button\`
        background: \${color.var};
        color: \${color.contrast.var};
      \`

      const Component = ({ themeColor }) => {
        return (
          <StyledButton dynamicColor={color.set(themeColor || undefined)}>
            Maybe Color
          </StyledButton>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1", true);
      const Component = ({ themeColor }) => {
        return (
          <button
            {...color._sp(themeColor || undefined, {
              className: "v1560qbr-2-StyledButton",
            })}
          >
            Maybe Color
          </button>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-StyledButton {
        background: var(--v1560qbr-1);
        color: var(--v1560qbr-1-c);
      }
      "
    `);
  });

  test('should handle conditional set with false', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const StyledButton = styled.button\`
        background: \${color.var};
        color: \${color.contrast.var};
      \`

      const Component = ({ isActive }) => {
        return (
          <StyledButton dynamicColor={color.set(isActive ? '#00ff00' : false)}>
            Active Color
          </StyledButton>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1", true);
      const Component = ({ isActive }) => {
        return (
          <button
            {...color._sp(isActive ? "#00ff00" : false, {
              className: "v1560qbr-2-StyledButton",
            })}
          >
            Active Color
          </button>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-StyledButton {
        background: var(--v1560qbr-1);
        color: var(--v1560qbr-1-c);
      }
      "
    `);
  });

  test('should throw error when using condition outside the set function', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createDynamicCssColor, styled } from 'vindur'

          const color = createDynamicCssColor()

          const StyledButton = styled.button\`
            background: \${color.var};
          \`

          const Component = ({ condition }) => {
            return (
              <StyledButton dynamicColor={condition ? color.set('#ff6b6b') : null}>
                This should throw an error
              </StyledButton>
            );
          }
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[TransformError: /test.tsx: Conditional dynamicColor is not supported. Use condition inside the set function instead: color.set(condition ? '#ff6b6b' : null)]`);
  });

  test('should throw error when using condition outside the set function with undefined', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createDynamicCssColor, styled } from 'vindur'

          const color = createDynamicCssColor()

          const StyledButton = styled.button\`
            background: \${color.var};
          \`

          const Component = ({ hasColor }) => {
            return (
              <StyledButton dynamicColor={hasColor ? color.set('#ff6b6b') : undefined}>
                This should also throw an error
              </StyledButton>
            );
          }
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[TransformError: /test.tsx: Conditional dynamicColor is not supported. Use condition inside the set function instead: color.set(hasColor ? '#ff6b6b' : undefined)]`);
  });

  test('should throw error when using logical AND with condition', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createDynamicCssColor, styled } from 'vindur'

          const color = createDynamicCssColor()

          const StyledButton = styled.button\`
            background: \${color.var};
          \`

          const Component = ({ shouldApplyColor }) => {
            return (
              <StyledButton dynamicColor={shouldApplyColor && color.set('#ff6b6b')}>
                Logical AND should throw
              </StyledButton>
            );
          }
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[TransformError: /test.tsx: Conditional dynamicColor is not supported. Use condition inside the set function instead: color.set(shouldApplyColor ? '#ff6b6b' : null)]`);
  });
});
