import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from './testUtils';

describe('JSX cx prop warnings', () => {
  describe('Warnings for Missing CSS Classes', () => {
    test('should warn about cx modifiers without corresponding CSS classes in dev mode', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Card = styled.div\`
            background: white;
            padding: 16px;

            &.active {
              background: blue;
            }

            &.disabled {
              opacity: 0.5;
            }
          \`;

          function Component({ isActive, isDisabled, isHighlighted }) {
            return (
              <Card cx={{ active: isActive, disabled: isDisabled, highlighted: isHighlighted }}>
                Content
              </Card>
            );
          }
        `,
        dev: true,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ isActive, isDisabled, isHighlighted }) {
          return (
            <div
              className={
                "v1560qbr-1-Card " +
                cx({
                  "v18wrjm2-active": isActive,
                  "v199pd0d-disabled": isDisabled,
                  "v6k42po-highlighted": isHighlighted,
                })
              }
            >
              Content
            </div>
          );
        }
        console.warn(
          \`Warning: Missing CSS classes for cx modifiers in Card: highlighted\`,
        );
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Card {
          background: white;
          padding: 16px;

          &.v18wrjm2-active {
            background: blue;
          }

          &.v199pd0d-disabled {
            opacity: 0.5;
          }
        }"
      `);
    });

    test('should warn about multiple cx modifiers without corresponding CSS classes in dev mode', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Widget = styled.div\`
            background: white;

            &.active {
              background: blue;
            }
          \`;

          function Component({ isActive, isDisabled, isHighlighted, isCompact }) {
            return (
              <Widget cx={{ active: isActive, disabled: isDisabled, highlighted: isHighlighted, compact: isCompact }}>
                Content
              </Widget>
            );
          }
        `,
        dev: true,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ isActive, isDisabled, isHighlighted, isCompact }) {
          return (
            <div
              className={
                "v1560qbr-1-Widget " +
                cx({
                  "v18wrjm2-active": isActive,
                  "v199pd0d-disabled": isDisabled,
                  "v6k42po-highlighted": isHighlighted,
                  "v184prwi-compact": isCompact,
                })
              }
            >
              Content
            </div>
          );
        }
        console.warn(
          \`Warning: Missing CSS classes for cx modifiers in Widget: disabled, highlighted, compact\`,
        );
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Widget {
          background: white;

          &.v18wrjm2-active {
            background: blue;
          }
        }"
      `);
    });

    test('should not warn in production mode', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Card = styled.div\`
            background: white;

            &.active {
              background: blue;
            }
          \`;

          function Component({ isActive, isHighlighted }) {
            return (
              <Card cx={{ active: isActive, highlighted: isHighlighted }}>
                Content
              </Card>
            );
          }
        `,
        dev: false,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ isActive, isHighlighted }) {
          return (
            <div
              className={
                "v1560qbr-1 " +
                cx({
                  v18wrjm2: isActive,
                  vkki7ul: isHighlighted,
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
        ".v1560qbr-1 {
          background: white;

          &.v18wrjm2 {
            background: blue;
          }
        }"
      `);
    });

    test('should not warn when all cx modifiers have corresponding CSS classes', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Button = styled.button\`
            padding: 8px;

            &.primary {
              background: blue;
            }

            &.disabled {
              opacity: 0.5;
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
              className={
                "v1560qbr-1-Button " +
                cx({
                  "vkrxp8d-primary": isPrimary,
                  "v199pd0d-disabled": isDisabled,
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
          padding: 8px;

          &.vkrxp8d-primary {
            background: blue;
          }

          &.v199pd0d-disabled {
            opacity: 0.5;
          }
        }"
      `);
    });

    test('should exclude $ prefixed props from missing CSS class checking', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Widget = styled.div\`
            padding: 10px;

            &.active {
              background: blue;
            }
          \`;

          function Component({ isActive, hasError, hasWarning }) {
            return <Widget cx={{ active: isActive, $error: hasError, warning: hasWarning }} />;
          }
        `,
        dev: true,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ isActive, hasError, hasWarning }) {
          return (
            <div
              className={
                "v1560qbr-1-Widget " +
                cx({
                  "v18wrjm2-active": isActive,
                  error: hasError,
                  "v2jf5l9-warning": hasWarning,
                })
              }
            />
          );
        }
        console.warn(
          \`Warning: Missing CSS classes for cx modifiers in Widget: warning\`,
        );
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Widget {
          padding: 10px;

          &.v18wrjm2-active {
            background: blue;
          }
        }"
      `);
    });

    test('should not warn when $ prefixed props have corresponding CSS classes', async () => {
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

            &.disabled {
              opacity: 0.5;
            }
          \`;

          function Component({ isActive, hasError, isDisabled }) {
            return <Widget cx={{ active: isActive, $error: hasError, $disabled: isDisabled }} />;
          }
        `,
        dev: true,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ isActive, hasError, isDisabled }) {
          return (
            <div
              className={
                "v1560qbr-1-Widget " +
                cx({
                  "v18wrjm2-active": isActive,
                  error: hasError,
                  disabled: isDisabled,
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

          &.v18wrjm2-active {
            background: blue;
          }

          &.error {
            color: red;
          }

          &.disabled {
            opacity: 0.5;
          }
        }"
      `);
    });
  });
});
