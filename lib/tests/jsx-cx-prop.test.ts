import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from './testUtils';

describe('JSX cx prop transformation', () => {
  // Basic functionality tests
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

          &.noHash {
            background: yellow;
          }
        \`;

        function Component({ isActive, isDisabled }) {
          return <StyledDiv cx={{ active: isActive, disabled: isDisabled, $noHash: true }} />;
        }
      `,
      dev: true,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "function Component({ isActive, isDisabled }) {
        return (
          <div
            className={'v1560qbr-1-StyledDiv' + cx({
              "v18wrjm2-active": isActive,
              "v199pd0d-disabled": isDisabled,
              noHash: true,
            })}
          />
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-StyledDiv {
        background: red;

        &.v18wrjm2-active {
          background: blue;
        }

        &.v199pd0d-disabled {
          background: green;
        }

        &.noHash {
          background: yellow;
        }
      }
      "
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
      dev: false,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "function Component({ isActive, isDisabled }) {
        return (
          <div
            className={\`v1560qbr-1 \${cx({
              v18wrjm2: isActive,
              v199pd0d: isDisabled,
            })}\`}
          />
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: red;

        &.active {
          background: blue;
        }

        &.disabled {
          background: green;
        }
      }
      "
    `);
  });

  test('should work with styled components and modifier classes', async () => {
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
      dev: true,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "function Component({ isPrimary, isDisabled }) {
        return (
          <button
            className={\`v1560qbr-1-Button \${cx({
              "vkrxp8d-primary": isPrimary,
              "v199pd0d-disabled": isDisabled,
            })}\`}
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

        &.primary {
          background: blue;
          color: white;
        }

        &.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      }
      "
    `);
  });

  test('should allow $ prefix for global classes only', async () => {
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
      dev: true,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "function Component({ isActive, hasError }) {
        return (
          <div
            className={\`v1560qbr-1-Widget \${cx({
              "v18wrjm2-active": isActive,
              error: hasError,
            })}\`}
          />
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Widget {
        padding: 10px;

        &.active {
          background: blue;
        }

        &.error {
          color: red;
        }
      }
      "
    `);
  });

  // Integration with other vindur features
  test('should work with css function and modifier classes', async () => {
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
      dev: true,
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
                "vge1qo3-featured": isFeatured,
                "vm4hlsi-compact": isCompact,
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

        &.featured {
          border-color: gold;
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        }

        &.compact {
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
      dev: true,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "function Component({ isHoverable }) {
        return (
          <div
            className={
              "v1560qbr-1-css-prop-1 " +
              cx({
                "v1abz60o-hoverable": isHoverable,
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

        &.hoverable {
          transform: scale(1.05);
        }
      }
      "
    `);
  });

  // Advanced scenarios
  test('should merge cx prop with existing className and styled components', async () => {
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
      dev: true,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "function Component({ isHighlighted }) {
        return (
          <div
            className={
              "base-class " +
              cx({
                "v1j9ou1z-highlighted": isHighlighted,
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

        &.highlighted {
          border-color: gold;
        }
      }
      "
    `);
  });

  test('should work with spread attributes', async () => {
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
      dev: true,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { mergeClassNames } from \\"vindur\\";
      function Component({ props, isActive }) {
        return (
          <button
            {...props}
            className={mergeClassNames(
              [
                mergeClassNames(
                  [props],
                  cx({
                    \\"v18wrjm2-active\\": isActive,
                  }),
                ),
                props,
              ],
              \\"v1560qbr-1-Button\\"
            )}
          />
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 8px;

        &.active {
          background: blue;
        }
      }
      "
    `);
  });

  test('should verify modifier class hashing consistency', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled, css, cx } from 'vindur';

        const Button = styled.button\`
          padding: 10px;

          &.primary {
            background: blue;
          }
        \`;

        const Card = css\`
          border: 1px solid #ddd;

          &.primary {
            border-color: blue;
          }
        \`;

        function Component() {
          return (
            <div>
              <Button cx={{ primary: true }}>Button</Button>
              <div className={Card} cx={{ primary: true }}>Card</div>
            </div>
          );
        }
      `,
      dev: true,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const Card = "v1560qbr-2-Card";
      function Component() {
        return (
          <div>
            <button
              className={\`v1560qbr-1-Button \${cx({
                "v1j9ou1z-primary": true,
              })}\`}
            >
              Button
            </button>
            <div
              className={
                Card +
                " " +
                cx({
                  "vlo2rjh-primary": true,
                })
              }
            >
              Card
            </div>
          </div>
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 10px;

        &.primary {
          background: blue;
        }
      }
      .v1560qbr-2-Card {
        border: 1px solid #ddd;

        &.primary {
          border-color: blue;
        }
      }
      "
    `);
  });

  // Error cases
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
