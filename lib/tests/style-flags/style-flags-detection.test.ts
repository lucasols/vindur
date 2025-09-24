import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

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
    "function Component() {
      return (
        <div className={"v1560qbr-1-StyledWithModifier voctcyj-active"}>
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
    "function Component() {
      return (
        <button className={"v1560qbr-1-Button v1puiack-primary vr4ikfs-size-large"}>
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
    "const ButtonElement = ({ children, ...props }) => (
      <button {...props}>{children}</button>
    );
    function Component({ isChecked }) {
      return (
        <ButtonElement
          className={
            "v1560qbr-1-CheckboxContainer" + (isChecked ? " v7k0mdb-checked" : "")
          }
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

test('reproduce bug', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Btn = styled(ButtonElement)<{ value: 'high' | 'medium' | 'low' }>\`
        border: 0;
        background: transparent;
        color: white;
        opacity: 0.7;

        &:hover {
          opacity: 1;
        }

        &.value-high {
          color: coral;
        }
        &.value-medium {
          color: yellow;
        }
        &.value-low {
          color: cyan;
        }
      \`;

      function Component({ value, css }) {
        return <Btn value={value} css={css}>Content</Btn>;
      }
    `,
    overrideDefaultFs: createFsMock({
      'button.ts': dedent`
        export const ButtonElement = ({ children, ...props }) => <button {...props}>{children}</button>;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component({ value, css }) {
      return (
        <ButtonElement
          css={css}
          className={cx(
            \`v1560qbr-1-Btn \${"v1560qbr-1-Btn"}\`,
            value && \`v3j7qq4-value-\${value}\`,
          )}
        >
          Content
        </ButtonElement>
      );
    }
    "
  `);
  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Btn {
      border: 0;
      background: transparent;
      color: white;
      opacity: 0.7;

      &:hover {
        opacity: 1;
      }

      &.v3j7qq4-value-high {
        color: coral;
      }
      &.v3j7qq4-value-medium {
        color: yellow;
      }
      &.v3j7qq4-value-low {
        color: cyan;
      }
    }
    "
  `);
});

test('should work with extracted type parameters', async () => {
  const result = await transformWithFormat({
    source: dedent`
      type BtnStyleFlags = {
        value: 'high' | 'medium' | 'low';
        active: boolean;
      };

      const Btn = styled(ButtonElement)<BtnStyleFlags>\`
        border: 0;
        background: transparent;
        color: white;

        &:hover,
        &.active {
          opacity: 1;
        }

        &.value-high {
          color: red;
        }
        &.value-medium {
          color: yellow;
        }
        &.value-low {
          color: cyan;
        }
      \`;

      function Component({ value, active }) {
        return <Btn value={value} active={active}>Content</Btn>;
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "type BtnStyleFlags = {
      value: "high" | "medium" | "low";
      active: boolean;
    };
    function Component({ value, active }) {
      return (
        <ButtonElement
          className={
            "v1560qbr-1-Btn" +
            (value ? " v3j7qq4-value-" + value : "") +
            (active ? " voctcyj-active" : "")
          }
        >
          Content
        </ButtonElement>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Btn {
      border: 0;
      background: transparent;
      color: white;

      &:hover,
      &.voctcyj-active {
        opacity: 1;
      }

      &.v3j7qq4-value-high {
        color: red;
      }
      &.v3j7qq4-value-medium {
        color: yellow;
      }
      &.v3j7qq4-value-low {
        color: cyan;
      }
    }
    "
  `);
});

test('should detect and transform style flags inside pseudo-class functions', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Button = styled.button<{
        active: boolean;
        disabled: boolean;
        size: 'small' | 'medium' | 'large';
        variant: 'primary' | 'secondary';
      }>\`
        padding: 8px 16px;
        border: 1px solid #ccc;
        background: white;
        color: #333;

        /* Test :not() with boolean flags */
        &:not(.disabled) {
          cursor: pointer;
        }

        &:not(.active):hover {
          background: #f0f0f0;
        }

        /* Test :is() with multiple classes including flags */
        &:is(.active, .other-class) {
          background: blue;
          color: white;
        }

        &:is(.variant-primary, .variant-secondary) {
          font-weight: bold;
        }

        /* Test :where() with flags */
        &:where(.size-small) {
          padding: 4px 8px;
        }

        /* Test :has() with flags */
        &:has(.active) {
          border-color: blue;
        }

        /* Test complex combinations */
        &:not(.disabled):is(.size-large, .size-medium) {
          min-height: 48px;
        }

        /* Test string union flags in different positions */
        &:is(.other, .variant-primary, .another) {
          text-transform: uppercase;
        }

        /* Traditional & syntax should still work */
        &.active {
          background: green;
        }

        &.size-large {
          padding: 12px 24px;
        }
      \`;

      function Component() {
        return (
          <Button
            active={true}
            disabled={false}
            size="large"
            variant="primary"
          >
            Click me
          </Button>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component() {
      return (
        <button
          className={
            "v1560qbr-1-Button voctcyj-active vr4ikfs-size-large v11as9cs-variant-primary"
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
      padding: 8px 16px;
      border: 1px solid #ccc;
      background: white;
      color: #333;

      /* Test :not() with boolean flags */
      &:not(.v1iz0um9-disabled) {
        cursor: pointer;
      }

      &:not(.voctcyj-active):hover {
        background: #f0f0f0;
      }

      /* Test :is() with multiple classes including flags */
      &:is(.voctcyj-active, .other-class) {
        background: blue;
        color: white;
      }

      &:is(.v11as9cs-variant-primary, .v11as9cs-variant-secondary) {
        font-weight: bold;
      }

      /* Test :where() with flags */
      &:where(.vr4ikfs-size-small) {
        padding: 4px 8px;
      }

      /* Test :has() with flags */
      &:has(.voctcyj-active) {
        border-color: blue;
      }

      /* Test complex combinations */
      &:not(.v1iz0um9-disabled):is(.vr4ikfs-size-large, .vr4ikfs-size-medium) {
        min-height: 48px;
      }

      /* Test string union flags in different positions */
      &:is(.other, .v11as9cs-variant-primary, .another) {
        text-transform: uppercase;
      }

      /* Traditional & syntax should still work */
      &.voctcyj-active {
        background: green;
      }

      &.vr4ikfs-size-large {
        padding: 12px 24px;
      }
    }
    "
  `);
});
