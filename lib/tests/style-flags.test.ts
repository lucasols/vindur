import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from './testUtils';

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
        dev: true,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { vComponentWithModifiers } from "vindur";
        const StyledWithModifier = vComponentWithModifiers(
          [
            ["active", "v18wrjm2-active"],
            ["disabled", "v199pd0d-disabled"],
          ],
          "v1560qbr-1-StyledWithModifier",
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

          &.v18wrjm2-active {
            background: blue;
          }

          &.v199pd0d-disabled {
            opacity: 0.5;
          }
        }"
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
        dev: true,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { vComponentWithModifiers } from "vindur";
        const Button = vComponentWithModifiers(
          [
            ["primary", "vkrxp8d-primary"],
            ["disabled", "v199pd0d-disabled"],
            ["size", "hash_placeholder-size"],
          ],
          "v1560qbr-1-Button",
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

          &.vkrxp8d-primary {
            background: blue;
            color: white;
          }

          &.v199pd0d-disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          &.hash_placeholder-size {
            padding: 4px 8px;
          }
        }"
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
        dev: true,
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
        }"
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
        dev: true,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { vComponentWithModifiers } from "vindur";
        const Widget = vComponentWithModifiers(
          [
            ["active", "v18wrjm2-active"],
            ["featured", "vge1qo3-featured"],
          ],
          "v1560qbr-1-Widget",
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

          &.v18wrjm2-active {
            background: blue;
          }

          &.vge1qo3-featured {
            border: 2px solid gold;
          }
        }"
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
        dev: false,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { vComponentWithModifiers } from "vindur";
        const Widget = vComponentWithModifiers(
          [
            ["active", "v18wrjm2"],
            ["featured", "vge1qo3"],
          ],
          "v1560qbr-1",
        );
        function Component() {
          return <Widget active={true} featured={false}>Content</Widget>;
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1 {
          background: white;

          &.v18wrjm2 {
            background: blue;
          }

          &.vge1qo3 {
            border: 2px solid gold;
          }
        }"
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
        dev: true,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { vComponentWithModifiers } from "vindur";
        const Button = vComponentWithModifiers(
          [["primary", "vkrxp8d-primary"]],
          "v1560qbr-1-Button",
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

          &.vkrxp8d-primary {
            background: blue;
            color: white;
          }
        }"
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
        dev: true,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { vComponentWithModifiers } from "vindur";
        const Button = vComponentWithModifiers(
          [["active", "v18wrjm2-active"]],
          "v1560qbr-1-Button",
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

          &.v18wrjm2-active {
            background: blue;
          }
        }"
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
        dev: true,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { vComponentWithModifiers } from "vindur";
        const Card = vComponentWithModifiers(
          [
            ["highlighted", "vzszlgd-highlighted"],
            ["disabled", "v199pd0d-disabled"],
          ],
          "v1560qbr-1-Card",
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

          &.vzszlgd-highlighted {
            border: 2px solid gold;
          }

          &.v199pd0d-disabled {
            opacity: 0.5;
          }
        }"
      `);
    });
  });

  describe('Error Handling', () => {
    test('should throw error for non-boolean types in style flags', async () => {
      await expect(
        transformWithFormat({
          source: dedent`
            import { styled } from 'vindur';

            const StyledWithModifier = styled.div<{
              status: 'active' | 'inactive'; // Not boolean
            }>\`
              &.active { ... }
            \`;
          `,
        }),
      ).rejects.toThrow(
        'Style flags only support boolean properties. Property "status" has type "active" | "inactive".',
      );
    });

    test('should warn about missing modifier styles', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const StyledWithModifier = styled.div<{
            active: boolean;
          }>\`
            padding: 16px;
            // Missing: &.active selector
          \`;

          function Component() {
            return (
              <StyledWithModifier active={true}>
                Content
              </StyledWithModifier>
            );
          }
        `,
        dev: true,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { vComponentWithModifiers } from "vindur";
        const StyledWithModifier = vComponentWithModifiers(
          [["active", "v18wrjm2-active"]],
          "v1560qbr-1-StyledWithModifier",
        );
        function Component() {
          return (
            <StyledWithModifier active={true}>
              Content
            </StyledWithModifier>
          );
        }
        if (process.env.NODE_ENV === "development") {
          console.warn(\`Warning: Missing modifier styles for "active" in StyledWithModifier\`);
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-StyledWithModifier {
          padding: 16px;
        }"
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
        dev: true,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { vComponentWithModifiers } from "vindur";
        export const Button = vComponentWithModifiers(
          [["primary", "vkrxp8d-primary"]],
          "v1560qbr-1-Button",
        );
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Button {
          padding: 8px 16px;

          &.vkrxp8d-primary {
            background: blue;
          }
        }"
      `);
    });
  });
});
