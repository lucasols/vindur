import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

test('should only apply to styled components, not regular DOM elements', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const StyledWithModifier = styled.div<{
        active: boolean;
        muted: boolean;
      }>\`
        padding: 16px;

        &.active {
          background: blue;
        }

        &.muted {
          opacity: 0.5;
        }
      \`;

      function Component() {
        return (
          <StyledWithModifier
            active={true}
            muted={false}
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
        <div
          className={
            "v1560qbr-1-StyledWithModifier v1560qbr-1-StyledWithModifier-active"
          }
        >
          Content
        </div>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-StyledWithModifier {
      padding: 16px;

      &.v1560qbr-1-StyledWithModifier-active {
        background: blue;
      }

      &.v1560qbr-1-StyledWithModifier-muted {
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
        muted: boolean;
      }>\`
        padding: 8px 16px;
        border: 1px solid #ccc;

        &.primary {
          background: blue;
          color: white;
        }

        &.muted {
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
            muted={false}
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
            "v1560qbr-1-Button v1560qbr-1-Button-primary v1560qbr-1-Button-size-large"
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

      &.v1560qbr-1-Button-primary {
        background: blue;
        color: white;
      }

      &.v1560qbr-1-Button-muted {
        opacity: 0.5;
        cursor: not-allowed;
      }

      &.v1560qbr-1-Button-size-small {
        padding: 4px 8px;
      }

      &.v1560qbr-1-Button-size-large {
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
        ticked: boolean;
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

        &.ticked {
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
          <CheckboxContainer ticked={isChecked}>
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
            "v1560qbr-1-CheckboxContainer" +
            (isChecked ? " v1560qbr-1-CheckboxContainer-ticked" : "")
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

      &.v1560qbr-1-CheckboxContainer-ticked {
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
    "function Component({ value, css }) {
      return (
        <ButtonElement
          css={css}
          className={
            "v1560qbr-1-Btn" + (value ? " v1560qbr-1-Btn-value-" + value : "")
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
      opacity: 0.7;

      &:hover {
        opacity: 1;
      }

      &.v1560qbr-1-Btn-value-high {
        color: coral;
      }
      &.v1560qbr-1-Btn-value-medium {
        color: yellow;
      }
      &.v1560qbr-1-Btn-value-low {
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
            (value ? " v1560qbr-1-Btn-value-" + value : "") +
            (active ? " v1560qbr-1-Btn-active" : "")
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
      &.v1560qbr-1-Btn-active {
        opacity: 1;
      }

      &.v1560qbr-1-Btn-value-high {
        color: red;
      }
      &.v1560qbr-1-Btn-value-medium {
        color: yellow;
      }
      &.v1560qbr-1-Btn-value-low {
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
        muted: boolean;
        size: 'small' | 'medium' | 'large';
        variant: 'primary' | 'secondary';
      }>\`
        padding: 8px 16px;
        border: 1px solid #ccc;
        background: white;
        color: #333;

        /* Test :not() with boolean flags */
        &:not(.muted) {
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
        &:not(.muted):is(.size-large, .size-medium) {
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
            muted={false}
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
            "v1560qbr-1-Button v1560qbr-1-Button-active v1560qbr-1-Button-size-large v1560qbr-1-Button-variant-primary"
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
      &:not(.v1560qbr-1-Button-muted) {
        cursor: pointer;
      }

      &:not(.v1560qbr-1-Button-active):hover {
        background: #f0f0f0;
      }

      /* Test :is() with multiple classes including flags */
      &:is(.v1560qbr-1-Button-active, .other-class) {
        background: blue;
        color: white;
      }

      &:is(
        .v1560qbr-1-Button-variant-primary,
        .v1560qbr-1-Button-variant-secondary
      ) {
        font-weight: bold;
      }

      /* Test :where() with flags */
      &:where(.v1560qbr-1-Button-size-small) {
        padding: 4px 8px;
      }

      /* Test :has() with flags */
      &:has(.active) {
        border-color: blue;
      }

      /* Test complex combinations */
      &:not(.v1560qbr-1-Button-muted):is(
          .v1560qbr-1-Button-size-large,
          .v1560qbr-1-Button-size-medium
        ) {
        min-height: 48px;
      }

      /* Test string union flags in different positions */
      &:is(.other, .v1560qbr-1-Button-variant-primary, .another) {
        text-transform: uppercase;
      }

      /* Traditional & syntax should still work */
      &.v1560qbr-1-Button-active {
        background: green;
      }

      &.v1560qbr-1-Button-size-large {
        padding: 12px 24px;
      }
    }
    "
  `);
});

test('should not read type arguments of other tags as style flags', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { html } from 'lit'

      export const tpl = html<{ disabled: boolean }>\`<b></b>\`
      export const style = css\`color: red;\`
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { html } from "lit";
    export const tpl = html<{ disabled: boolean }>\`<b></b>\`;
    export const style = "v1560qbr-1-style";
    "
  `);
});

test('should resolve exported type aliases of style flags', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      export type Props = { active: boolean }

      const Box = styled.div<Props>\`&.active { color: red; }\`

      export const App = ({ on }) => <Box active={on} />
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export type Props = { active: boolean };
    export const App = ({ on }) => (
      <div className={"v1560qbr-1-Box" + (on ? " v1560qbr-1-Box-active" : "")} />
    );
    "
  `);
});
