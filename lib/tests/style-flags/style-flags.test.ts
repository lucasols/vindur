import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('Style Flags Transform Logic', () => {
  describe('Detection and Validation', () => {
    test('should only apply to styled components, not regular DOM elements', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const StyledWithModifier = styled.div<{
            active: boolean;
            disabled: boolean;
          }>\`
            padding: 16px;

            &.active {
              background: blue;
            }

            &.disabled {
              opacity: 0.5;
            }
          \`;

          function Component() {
            return (
              <StyledWithModifier
                active={true}
                disabled={false}
              >
                Content
              </StyledWithModifier>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const StyledWithModifier = _vCWM(
          [
            ["active", "voctcyj-active"],
            ["disabled", "v1iz0um9-disabled"],
          ],
          "v1560qbr-1-StyledWithModifier",
          "div",
        );
        function Component() {
          return (
            <StyledWithModifier active={true} disabled={false}>
              Content
            </StyledWithModifier>
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-StyledWithModifier {
          padding: 16px;

          &.voctcyj-active {
            background: blue;
          }

          &.v1iz0um9-disabled {
            opacity: 0.5;
          }
        }
        "
      `);
    });

    test('should extract boolean and string union properties from TypeScript generic type', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Button = styled.button<{
            primary: boolean;
            size: 'small' | 'large';
            disabled: boolean;
          }>\`
            padding: 8px 16px;
            border: 1px solid #ccc;

            &.primary {
              background: blue;
              color: white;
            }

            &.disabled {
              opacity: 0.5;
              cursor: not-allowed;
            }

            &.size-small {
              padding: 4px 8px;
            }

            &.size-large {
              padding: 12px 24px;
            }
          \`;

          function Component() {
            return (
              <Button
                primary={true}
                size="large"
                disabled={false}
              >
                Click me
              </Button>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Button = _vCWM(
          [
            ["primary", "v1puiack-primary"],
            ["size", "vr4ikfs-size"],
            ["disabled", "v1iz0um9-disabled"],
          ],
          "v1560qbr-1-Button",
          "button",
        );
        function Component() {
          return (
            <Button primary={true} size="large" disabled={false}>
              Click me
            </Button>
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Button {
          padding: 8px 16px;
          border: 1px solid #ccc;

          &.v1puiack-primary {
            background: blue;
            color: white;
          }

          &.v1iz0um9-disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          &.vr4ikfs-size-small {
            padding: 4px 8px;
          }

          &.vr4ikfs-size-large {
            padding: 12px 24px;
          }
        }
        "
      `);
    });

    test('should handle styled components without generics normally', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Card = styled.div\`
            padding: 16px;
            border: 1px solid #ddd;
          \`;

          function Component() {
            return <Card>Content</Card>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component() {
          return <div className="v1560qbr-1-Card">Content</div>;
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Card {
          padding: 16px;
          border: 1px solid #ddd;
        }
        "
      `);
    });
  });

  describe('CSS Class Name Hashing', () => {
    test('should hash modifier class names in dev mode', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Widget = styled.div<{
            active: boolean;
            featured: boolean;
          }>\`
            background: white;

            &.active {
              background: blue;
            }

            &.featured {
              border: 2px solid gold;
            }
          \`;

          function Component() {
            return (
              <Widget active={true} featured={false}>
                Content
              </Widget>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Widget = _vCWM(
          [
            ["active", "voctcyj-active"],
            ["featured", "vnwmeu-featured"],
          ],
          "v1560qbr-1-Widget",
          "div",
        );
        function Component() {
          return (
            <Widget active={true} featured={false}>
              Content
            </Widget>
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Widget {
          background: white;

          &.voctcyj-active {
            background: blue;
          }

          &.vnwmeu-featured {
            border: 2px solid gold;
          }
        }
        "
      `);
    });

    test('should hash modifier class names without suffix in production mode', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Widget = styled.div<{
            active: boolean;
            featured: boolean;
          }>\`
            background: white;

            &.active {
              background: blue;
            }

            &.featured {
              border: 2px solid gold;
            }
          \`;

          function Component() {
            return (
              <Widget active={true} featured={false}>
                Content
              </Widget>
            );
          }
        `,
        production: true,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Widget = _vCWM(
          [
            ["active", "voctcyj"],
            ["featured", "vnwmeu"],
          ],
          "v1560qbr-1",
          "div",
        );
        function Component() {
          return (
            <Widget active={true} featured={false}>
              Content
            </Widget>
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1 {
          background: white;

          &.voctcyj {
            background: blue;
          }

          &.vnwmeu {
            border: 2px solid gold;
          }
        }
        "
      `);
    });
  });

  describe('Integration with Other Features', () => {
    test('should work with existing className', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Button = styled.button<{
            primary: boolean;
          }>\`
            padding: 8px 16px;
            border: 1px solid #ccc;

            &.primary {
              background: blue;
              color: white;
            }
          \`;

          function Component() {
            return (
              <Button
                primary={true}
                className="extra-class"
              >
                Click me
              </Button>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Button = _vCWM(
          [["primary", "v1puiack-primary"]],
          "v1560qbr-1-Button",
          "button",
        );
        function Component() {
          return (
            <Button primary={true} className="extra-class">
              Click me
            </Button>
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Button {
          padding: 8px 16px;
          border: 1px solid #ccc;

          &.v1puiack-primary {
            background: blue;
            color: white;
          }
        }
        "
      `);
    });

    test('should work with spread props', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Button = styled.button<{
            active: boolean;
          }>\`
            padding: 8px;

            &.active {
              background: blue;
            }
          \`;

          function Component({ props }) {
            return (
              <Button
                active={true}
                {...props}
              >
                Content
              </Button>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Button = _vCWM(
          [["active", "voctcyj-active"]],
          "v1560qbr-1-Button",
          "button",
        );
        function Component({ props }) {
          return (
            <Button active={true} {...props}>
              Content
            </Button>
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Button {
          padding: 8px;

          &.voctcyj-active {
            background: blue;
          }
        }
        "
      `);
    });

    test('should work with dynamic values', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Card = styled.div<{
            highlighted: boolean;
            disabled: boolean;
          }>\`
            padding: 16px;

            &.highlighted {
              border: 2px solid gold;
            }

            &.disabled {
              opacity: 0.5;
            }
          \`;

          function Component({ isHighlighted, isDisabled }) {
            return (
              <Card
                highlighted={isHighlighted}
                disabled={isDisabled}
              >
                Content
              </Card>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Card = _vCWM(
          [
            ["highlighted", "vges7p7-highlighted"],
            ["disabled", "v1iz0um9-disabled"],
          ],
          "v1560qbr-1-Card",
          "div",
        );
        function Component({ isHighlighted, isDisabled }) {
          return (
            <Card highlighted={isHighlighted} disabled={isDisabled}>
              Content
            </Card>
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Card {
          padding: 16px;

          &.vges7p7-highlighted {
            border: 2px solid gold;
          }

          &.v1iz0um9-disabled {
            opacity: 0.5;
          }
        }
        "
      `);
    });
  });

  describe('Error Handling', () => {
    test('should throw error for non-boolean and non-string-union types in style flags', async () => {
      await expect(
        transformWithFormat({
          source: dedent`
            import { styled } from 'vindur';

            const StyledWithModifier = styled.div<{
              count: number; // Not boolean or string union
            }>\`
              &.active { ... }
            \`;
          `,
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.tsx: Style flags only support boolean properties and string literal unions. Property "count" has type "number".
        loc: {
          "column": 2,
          "filename": undefined,
          "line": 4,
        }]
      `,
      );
    });

    test('should warn about missing modifier styles', async () => {
      const warnings: string[] = [];
      
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const StyledWithModifier = styled.div<{
            active: boolean;
          }>\`
            padding: 16px;
          \`;

          function Component() {
            return (
              <StyledWithModifier active={true}>
                Content
              </StyledWithModifier>
            );
          }
        `,
        onWarning: (warning) => {
          warnings.push(warning.message);
        },
      });

      expect(warnings).toContain(
        'Warning: Missing modifier styles for "&.active" in StyledWithModifier',
      );

      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const StyledWithModifier = _vCWM(
          [["active", "voctcyj-active"]],
          "v1560qbr-1-StyledWithModifier",
          "div",
        );
        function Component() {
          return <StyledWithModifier active={true}>Content</StyledWithModifier>;
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-StyledWithModifier {
          padding: 16px;
        }
        "
      `);
    });
  });

  describe('Exported Styled Components', () => {
    test('should handle exported styled components with style flags', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          export const Button = styled.button<{
            primary: boolean;
          }>\`
            padding: 8px 16px;

            &.primary {
              background: blue;
            }
          \`;
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        export const Button = _vCWM(
          [["primary", "v1puiack-primary"]],
          "v1560qbr-1-Button",
          "button",
        );
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Button {
          padding: 8px 16px;

          &.v1puiack-primary {
            background: blue;
          }
        }
        "
      `);
    });
  });
});
