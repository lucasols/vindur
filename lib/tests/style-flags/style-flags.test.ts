import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { describe, expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
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
        "import { cx } from "vindur";
        function Component() {
          return (
            <div className={cx("v1560qbr-1-StyledWithModifier", "voctcyj-active")}>
              Content
            </div>
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
        "import { cx } from "vindur";
        function Component() {
          return (
            <button
              className={cx(
                "v1560qbr-1-Button",
                "v1puiack-primary",
                "vr4ikfs-size-large",
              )}
            >
              Click me
            </button>
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

    test('should support extending custom components with style flags', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const ButtonElement = ({ children, ...props }) => <button {...props}>{children}</button>;

          const CheckboxContainer = styled(ButtonElement)<{
            checked: boolean;
          }>\`
            width: 14px;
            height: 14px;
            cursor: pointer;
            background: transparent;
            border: 1px solid #ccc;
            border-radius: 2px;
            opacity: 0.6;

            &:hover {
              opacity: 0.8;
              border-color: #aaa;
            }

            &.checked {
              background: #0066cc;
              border-color: #0066cc;
              opacity: 1;
            }

            &::after {
              content: '✓';
              color: white;
              font-size: 10px;
              line-height: 1;
              font-weight: bold;
            }
          \`;

          function Component({ isChecked }) {
            return (
              <CheckboxContainer checked={isChecked}>
              </CheckboxContainer>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { cx } from "vindur";
        const ButtonElement = ({ children, ...props }) => (
          <button {...props}>{children}</button>
        );
        function Component({ isChecked }) {
          return (
            <ButtonElement
              className={cx(
                "v1560qbr-1-CheckboxContainer",
                isChecked && "v7k0mdb-checked",
              )}
            ></ButtonElement>
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-CheckboxContainer {
          width: 14px;
          height: 14px;
          cursor: pointer;
          background: transparent;
          border: 1px solid #ccc;
          border-radius: 2px;
          opacity: 0.6;

          &:hover {
            opacity: 0.8;
            border-color: #aaa;
          }

          &.v7k0mdb-checked {
            background: #0066cc;
            border-color: #0066cc;
            opacity: 1;
          }

          &::after {
            content: "✓";
            color: white;
            font-size: 10px;
            line-height: 1;
            font-weight: bold;
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
        "import { cx } from "vindur";
        function Component() {
          return (
            <div className={cx("v1560qbr-1-Widget", "voctcyj-active")}>Content</div>
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
        "import { cx } from "vindur";
        function Component() {
          return <div className={cx("v1560qbr-1", "voctcyj")}>Content</div>;
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
        "import { cx } from "vindur";
        function Component() {
          return (
            <button className={cx("v1560qbr-1-Button extra-class", "v1puiack-primary")}>
              Click me
            </button>
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
        "import { cx, mergeClassNames } from "vindur";
        function Component({ props }) {
          return (
            <button
              {...props}
              className={cx(
                mergeClassNames([props], "v1560qbr-1-Button"),
                "voctcyj-active",
              )}
            >
              Content
            </button>
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
        "import { cx } from "vindur";
        function Component({ isHighlighted, isDisabled }) {
          return (
            <div
              className={cx(
                "v1560qbr-1-Card",
                isHighlighted && "vges7p7-highlighted",
                isDisabled && "v1iz0um9-disabled",
              )}
            >
              Content
            </div>
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

    test('should inline with dynamicColor and merge modifier classes via _sp', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled, createDynamicCssColor } from 'vindur';
          const color = createDynamicCssColor();
          const Box = styled.div<{
            active: boolean;
            size: 'small' | 'large';
          }>\`
            padding: 4px;
            &.active { outline: 1px solid red; }
            &.size-small { padding: 2px; }
            &.size-large { padding: 6px; }
          \`;
          function Component({ isOn }) {
            return (
              <Box
                active={isOn}
                size="small"
                dynamicColor={color}
                className="u"
              />
            );
          }
        `,
      });
      expect(result.code).toMatchInlineSnapshot(`
        "import { createDynamicCssColor, cx } from \"vindur\";
        const color = createDynamicCssColor(\"v1560qbr-1\", true);
        function Component({ isOn }) {
          return (
            <div
              {...color._sp(\"#ff6b6b\", {
                className: cx(
                  \"v1560qbr-2-Box u\",
                  \"vr4ikfs-size-small\",
                  isOn && \"voctcyj-active\",
                ),
              })}
            />
          );
        }
        "
      `);
      // CSS snapshot covered by other tests; focus on className merging here.
    });
    test('should inline with withComponent for local style-flagged components', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';
          const Base = styled.div<{ active: boolean }>\`
            &.active { color: red; }
          \`;
          const SpanBase = Base.withComponent('span');
          function Component() {
            return <SpanBase active={true}>X</SpanBase>;
          }
        `,
      });
      expect(result.code).toMatchInlineSnapshot(`
        "import { cx } from \"vindur\";
        function Component() {
          return <span className={cx(\"v1560qbr-1-Base\", \"voctcyj-active\")}>X</span>;
        }
        "
      `);
      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Base {
          &.voctcyj-active {
            color: red;
          }
        }
        "
      `);
    });
    test('should use wrapper with withComponent when exported', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';
          const Base = styled.div<{ active: boolean }>\`
            &.active { color: red; }
          \`;
          export const SpanBase = Base.withComponent('span');
        `,
      });
      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from \"vindur\";
        export const SpanBase = _vCWM(
          [[\"active\", \"voctcyj-active\"]],
          \"v1560qbr-1-Base\",
          \"span\",
        );
        "
      `);
    });
    test('should use wrapper when attrs are present even if not exported', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';
          const Button = styled.button.attrs({ type: 'button' })<{ primary: boolean }>\`
            &.primary { background: blue; }
          \`;
        `,
      });
      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from \"vindur\";
        const Button = _vCWM(
          [[\"primary\", \"v1puiack-primary\"]],
          \"v1560qbr-1-Button\",
          \"button\",
          {
            type: \"button\",
          },
        );
        "
      `);
      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Button {
          &.v1puiack-primary {
            background: blue;
          }
        }
        "
      `);
    });
    test('should merge className when className comes before spreads', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';
          const Item = styled.div<{ active: boolean }>\`
            &.active { color: red; }
          \`;
          function Component(props) {
            return <Item className="u" active={true} {...props} />;
          }
        `,
      });
      expect(result.code).toMatchInlineSnapshot(`
        "import { cx, mergeClassNames } from \"vindur\";
        function Component(props) {
          return (
            <div
              {...props}
              className={cx(
                mergeClassNames([\"u\", props], \"v1560qbr-1-Item\"),
                \"voctcyj-active\",
              )}
            />
          );
        }
        "
      `);
      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Item {
          &.voctcyj-active {
            color: red;
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
        loc: 4:2]
      `,
      );
    });

    test('should warn about missing modifier styles', async () => {
      const warnings: TransformWarning[] = [];

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
          warnings.push(warning);
        },
      });

      expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
        "
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.active" in StyledWithModifier'
            loc: 'current_file:3:6'
        "
      `);

      expect(result.code).toMatchInlineSnapshot(`
        "import { cx } from "vindur";
        function Component() {
          return (
            <div className={cx("v1560qbr-1-StyledWithModifier", "voctcyj-active")}>
              Content
            </div>
          );
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
