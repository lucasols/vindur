import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from './testUtils';

describe('JSX cx prop transformation', () => {
  // Detection and Validation
  describe('Detection and Validation', () => {
    test('should throw error for custom components', async () => {
      await expect(
        transformWithFormat({
          source: dedent`
            import { cx } from 'vindur';

            function CustomComponent() {
              return <span>Custom</span>;
            }

            function Component() {
              return <CustomComponent cx={{ active: true }} />;
            }
          `,
        }),
      ).rejects.toThrow(
        'cx prop is not supported on custom component "CustomComponent". The cx prop only works on native DOM elements (like div, span, button) and styled components.',
      );
    });

    test('should throw error for non-object expressions', async () => {
      await expect(
        transformWithFormat({
          source: dedent`
            import { cx } from 'vindur';

            function Component() {
              return <div cx={true} />;
            }
          `,
        }),
      ).rejects.toThrow('cx prop only accepts object expressions');
    });
  });

  // Object-based Conditional Classes
  describe('Object-based Conditional Classes', () => {
    test('should transform cx prop into cx function call with styled components', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Button = styled.button\`
            padding: 10px;
            border: 1px solid #ccc;

            &.primary {
              background: blue;
              color: white;
            }

            &.disabled {
              opacity: 0.5;
              cursor: not-allowed;
            }
          \`;

          function Component({ isPrimary, isDisabled }) {
            return (
              <Button cx={{ primary: isPrimary, disabled: isDisabled }}>
                Click me
              </Button>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ isPrimary, isDisabled }) {
          return (
            <button
              className={
                "v1560qbr-1-Button " +
                cx({
                  "v1560qbr-2-primary": isPrimary,
                  "v1560qbr-3-disabled": isDisabled,
                })
              }
            >
              Click me
            </button>
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Button {
          padding: 10px;
          border: 1px solid #ccc;

          &.v1560qbr-2-primary {
            background: blue;
            color: white;
          }

          &.v1560qbr-3-disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
        }"
      `);
    });
  });

  // Class Name Hashing
  describe('Class Name Hashing', () => {
    describe('Default Behavior (Hashed Classes)', () => {
      test('should hash class names in dev mode', async () => {
        const result = await transformWithFormat({
          source: dedent`
            import { styled, cx } from 'vindur';

            const StyledDiv = styled.div\`
              background: red;

              &.active {
                background: blue;
              }

              &.disabled {
                background: green;
              }
            \`;

            function Component({ isActive, isDisabled }) {
              return <StyledDiv cx={{ active: isActive, disabled: isDisabled }} />;
            }
          `,
        });

        expect(result.code).toMatchInlineSnapshot(`
          "function Component({ isActive, isDisabled }) {
            return (
              <div
                className={
                  "v1560qbr-1-StyledDiv " +
                  cx({
                    "v1560qbr-2-active": isActive,
                    "v1560qbr-3-disabled": isDisabled,
                  })
                }
              />
            );
          }
          "
        `);

        expect(result.css).toMatchInlineSnapshot(`
          ".v1560qbr-1-StyledDiv {
            background: red;

            &.v1560qbr-2-active {
              background: blue;
            }

            &.v1560qbr-3-disabled {
              background: green;
            }
          }"
        `);
      });

      test('should hash class names without suffix in production mode', async () => {
        const result = await transformWithFormat({
          source: dedent`
            import { styled, cx } from 'vindur';

            const StyledDiv = styled.div\`
              background: red;

              &.active {
                background: blue;
              }

              &.disabled {
                background: green;
              }
            \`;

            function Component({ isActive, isDisabled }) {
              return <StyledDiv cx={{ active: isActive, disabled: isDisabled }} />;
            }
          `,
          production: true,
        });

        expect(result.code).toMatchInlineSnapshot(`
          "function Component({ isActive, isDisabled }) {
            return (
              <div
                className={
                  "v1560qbr-1 " +
                  cx({
                    "v1560qbr-2": isActive,
                    "v1560qbr-3": isDisabled,
                  })
                }
              />
            );
          }
          "
        `);

        expect(result.css).toMatchInlineSnapshot(`
          ".v1560qbr-1 {
            background: red;

            &.v1560qbr-2 {
              background: blue;
            }

            &.v1560qbr-3 {
              background: green;
            }
          }"
        `);
      });
    });

    describe('Preventing Hashing with $ Prefix', () => {
      test('should prevent hashing for classes with $ prefix', async () => {
        const result = await transformWithFormat({
          source: dedent`
            import { styled, cx } from 'vindur';

            const Widget = styled.div\`
              padding: 10px;

              &.active {
                background: blue;
              }

              &.error {
                color: red;
              }
            \`;

            function Component({ isActive, hasError }) {
              return <Widget cx={{ active: isActive, $error: hasError }} />;
            }
          `,
        });

        expect(result.code).toMatchInlineSnapshot(`
          "function Component({ isActive, hasError }) {
            return (
              <div
                className={
                  "v1560qbr-1-Widget " +
                  cx({
                    "v1560qbr-2-active": isActive,
                    error: hasError,
                  })
                }
              />
            );
          }
          "
        `);

        expect(result.css).toMatchInlineSnapshot(`
          ".v1560qbr-1-Widget {
            padding: 10px;

            &.v1560qbr-2-active {
              background: blue;
            }

            &.error {
              color: red;
            }
          }"
        `);
      });

      test('should remove $ prefix and leave class name unhashed', async () => {
        const result = await transformWithFormat({
          source: dedent`
            import { styled, cx } from 'vindur';

            const StyledDiv = styled.div\`
              background: red;

              &.noHash {
                background: yellow;
              }
            \`;

            function Component() {
              return <StyledDiv cx={{ $noHash: true }} />;
            }
          `,
        });

        expect(result.code).toMatchInlineSnapshot(`
          "function Component() {
            return (
              <div
                className={
                  "v1560qbr-1-StyledDiv " +
                  cx({
                    noHash: true,
                  })
                }
              />
            );
          }
          "
        `);

        expect(result.css).toMatchInlineSnapshot(`
          ".v1560qbr-1-StyledDiv {
            background: red;

            &.noHash {
              background: yellow;
            }
          }"
        `);
      });
    });
  });

  // Integration with Other Props
  describe('Integration with Other Props', () => {
    describe('With Existing className', () => {
      test('should merge cx prop with existing className', async () => {
        const result = await transformWithFormat({
          source: dedent`
            import { styled, cx } from 'vindur';

            const Card = styled.div\`
              border: 1px solid #ddd;

              &.highlighted {
                border-color: gold;
              }
            \`;

            function Component({ isHighlighted }) {
              return <Card className="base-class" cx={{ highlighted: isHighlighted }} />;
            }
          `,
        });

        expect(result.code).toMatchInlineSnapshot(`
          "function Component({ isHighlighted }) {
            return (
              <div
                className={
                  "base-class v1560qbr-1-Card " +
                  cx({
                    "v1560qbr-2-highlighted": isHighlighted,
                  })
                }
              />
            );
          }
          "
        `);

        expect(result.css).toMatchInlineSnapshot(`
          ".v1560qbr-1-Card {
            border: 1px solid #ddd;

            &.v1560qbr-2-highlighted {
              border-color: gold;
            }
          }"
        `);
      });
    });

    describe('With css prop', () => {
      test('should work with css function and cx prop', async () => {
        const result = await transformWithFormat({
          source: dedent`
            import { css, cx } from 'vindur';

            const cardStyles = css\`
              background: white;
              border: 1px solid #ddd;
              padding: 16px;

              &.featured {
                border-color: gold;
                box-shadow: 0 4px 8px rgba(0,0,0,0.1);
              }

              &.compact {
                padding: 8px;
              }
            \`;

            function Component({ isFeatured, isCompact }) {
              return (
                <div 
                  className={cardStyles}
                  cx={{ featured: isFeatured, compact: isCompact }}
                >
                  Card content
                </div>
              );
            }
          `,
        });

        expect(result.code).toMatchInlineSnapshot(`
          "const cardStyles = "v1560qbr-1-cardStyles";
          function Component({ isFeatured, isCompact }) {
            return (
              <div
                className={
                  cardStyles +
                  " " +
                  cx({
                    "v1560qbr-2-featured": isFeatured,
                    "v1560qbr-3-compact": isCompact,
                  })
                }
              >
                Card content
              </div>
            );
          }
          "
        `);

        expect(result.css).toMatchInlineSnapshot(`
          ".v1560qbr-1-cardStyles {
            background: white;
            border: 1px solid #ddd;
            padding: 16px;

            &.v1560qbr-2-featured {
              border-color: gold;
              box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            }

            &.v1560qbr-3-compact {
              padding: 8px;
            }
          }"
        `);
      });

      test('should work with css prop and cx prop together', async () => {
        const result = await transformWithFormat({
          source: dedent`
            import { cx } from 'vindur';

            function Component({ isHoverable }) {
              return (
                <div
                  css={\`
                    background: red;
                    padding: 20px;

                    &.hoverable {
                      transform: scale(1.05);
                    }
                  \`}
                  cx={{ hoverable: isHoverable }}
                >
                  Content
                </div>
              );
            }
          `,
        });

        expect(result.code).toMatchInlineSnapshot(`
          "function Component({ isHoverable }) {
            return (
              <div
                className={
                  "v1560qbr-1-css-prop-1 " +
                  cx({
                    "v1560qbr-2-hoverable": isHoverable,
                  })
                }
              >
                Content
              </div>
            );
          }
          "
        `);

        expect(result.css).toMatchInlineSnapshot(`
          ".v1560qbr-1-css-prop-1 {
            background: red;
                  padding: 20px;

                  &.v1560qbr-2-hoverable {
                    transform: scale(1.05);
                  }
          }"
        `);
      });
    });

    describe('With Spread Props', () => {
      test('should work with spread attributes using mergeClassNames', async () => {
        const result = await transformWithFormat({
          source: dedent`
            import { styled, cx, mergeClassNames } from 'vindur';

            const Button = styled.button\`
              padding: 8px;

              &.active {
                background: blue;
              }
            \`;

            function Component({ props, isActive }) {
              return <Button {...props} cx={{ active: isActive }} />;
            }
          `,
        });

        expect(result.code).toMatchInlineSnapshot(`
          "import { mergeClassNames } from "vindur";
          function Component({ props, isActive }) {
            return (
              <button
                {...props}
                className={mergeClassNames(
                  [props],
                  "v1560qbr-1-Button " +
                    cx({
                      "v1560qbr-2-active": isActive,
                    }),
                )}
              />
            );
          }
          "
        `);

        expect(result.css).toMatchInlineSnapshot(`
          ".v1560qbr-1-Button {
            padding: 8px;

            &.v1560qbr-2-active {
              background: blue;
            }
          }"
        `);
      });
    });
  });
});
