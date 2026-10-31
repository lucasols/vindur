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
        background: \${themeColor.value};
        color: \${themeColor.contrast.value};

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
      "import { themeColor } from "#/colors";
      const Component = () => {
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
        background: var(--vip4ilp-1-themeColor);
        color: var(--vip4ilp-1-themeColor-c);

        &.vip4ilp-1-themeColor-self-isDark {
          border: 1px solid white;
        }

        .vip4ilp-1-themeColor-container-isLight & {
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
      }
      "
    `);
  });

  test('should forward set options without props to merge', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createDynamicCssColor } from 'vindur'

        const color = createDynamicCssColor()

        const Component = ({ value }) => {
          return <div dynamicColor={color.set(value, { veryDarkThreshold: 0.12 })} />;
        }
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1-color", true);
      const Component = ({ value }) => {
        return (
          <div
            {...color._sp(value, undefined, {
              veryDarkThreshold: 0.12,
            })}
          />
        );
      };
      "
    `);
  });

  test('should handle conditional set inside the set function', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const StyledButton = styled.button\`
        background: \${color.value};
        color: \${color.contrast.value};
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
      const color = createDynamicCssColor("v1560qbr-1-color", true);
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
        background: var(--v1560qbr-1-color);
        color: var(--v1560qbr-1-color-c);
      }
      "
    `);
  });

  test('should handle conditional set with undefined', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const StyledButton = styled.button\`
        background: \${color.value};
        color: \${color.contrast.value};
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
      const color = createDynamicCssColor("v1560qbr-1-color", true);
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
        background: var(--v1560qbr-1-color);
        color: var(--v1560qbr-1-color-c);
      }
      "
    `);
  });

  test('should handle conditional set with false', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const StyledButton = styled.button\`
        background: \${color.value};
        color: \${color.contrast.value};
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
      const color = createDynamicCssColor("v1560qbr-1-color", true);
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
        background: var(--v1560qbr-1-color);
        color: var(--v1560qbr-1-color-c);
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
            background: \${color.value};
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
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: Conditional dynamicColor is not supported. Use condition inside the set function instead: color.set(condition ? '#ff6b6b' : null)
      loc: 11:32]
    `);
  });

  test('should throw error when using condition outside the set function with undefined', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createDynamicCssColor, styled } from 'vindur'

          const color = createDynamicCssColor()

          const StyledButton = styled.button\`
            background: \${color.value};
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
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: Conditional dynamicColor is not supported. Use condition inside the set function instead: color.set(hasColor ? '#ff6b6b' : undefined)
      loc: 11:32]
    `);
  });

  test('should throw error when using logical AND with condition', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createDynamicCssColor, styled } from 'vindur'

          const color = createDynamicCssColor()

          const StyledButton = styled.button\`
            background: \${color.value};
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
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: Conditional dynamicColor is not supported. Use condition inside the set function instead: color.set(shouldApplyColor ? '#ff6b6b' : null)
      loc: 11:32]
    `);
  });

  test('should throw error for an empty dynamicColor array', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur'

          const color = createDynamicCssColor()

          const Component = () => <div dynamicColor={[]} />
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: dynamicColor array must contain at least one color.set(...)
      loc: 5:43]
    `);
  });

  test('should throw when set receives a spread argument', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur'

          const color = createDynamicCssColor()

          export const App = ({ args }) => <div dynamicColor={color.set(...args)} />
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: dynamicColor prop must be \`color.set(value)\` or \`color.set(value, options)\`, or an array of them, where \`color\` is a dynamic color
      loc: 5:52]
    `);
  });
});
