import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

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
        <div className="v1560qbr-1-StyledWithModifier voctcyj-active">
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
        <button className="v1560qbr-1-Button v1puiack-primary vr4ikfs-size-large">
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
            "v1560qbr-1-CheckboxContainer" +
            (isChecked ? " v7k0mdb-checked" : "")
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
