import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

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
    "function Component() {
      return (
        <button className="v1560qbr-1-Button extra-class v1puiack-primary">
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

      const Button = styled.button<{
        active: boolean;
        size: 'small' | 'large';
      }>\`
        padding: 8px;

        &.active {
          background: blue;
        }

        &.size-small {
          padding: 4px;
        }

        &.size-large {
          padding: 12px;
        }
      \`;

      function Component({ isActive, buttonSize }) {
        return (
          <Button
            active={isActive}
            size={buttonSize}
          >
            Content
          </Button>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component({ isActive, buttonSize }) {
      return (
        <button
          className={cx(
            "v1560qbr-1-Button",
            isActive && "voctcyj-active",
            buttonSize && \`vr4ikfs-size-\${buttonSize}\`,
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

      &.vr4ikfs-size-small {
        padding: 4px;
      }

      &.vr4ikfs-size-large {
        padding: 12px;
      }
    }
    "
  `);
});
