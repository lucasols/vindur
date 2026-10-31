import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
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
        <button
          className={"v1560qbr-1-Button extra-class v1560qbr-1-Button-primary"}
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
    "import { mergeClassNames } from "vindur";
    function Component({ props }) {
      return (
        <button
          {...props}
          className={mergeClassNames(
            [props],
            "v1560qbr-1-Button v1560qbr-1-Button-active",
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

      &.v1560qbr-1-Button-active {
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
    "function Component({ isActive, buttonSize }) {
      return (
        <button
          className={
            "v1560qbr-1-Button" +
            (isActive ? " v1560qbr-1-Button-active" : "") +
            (buttonSize ? " v1560qbr-1-Button-size-" + buttonSize : "")
          }
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

      &.v1560qbr-1-Button-active {
        background: blue;
      }

      &.v1560qbr-1-Button-size-small {
        padding: 4px;
      }

      &.v1560qbr-1-Button-size-large {
        padding: 12px;
      }
    }
    "
  `);
});

test('should preserve conditional expression precedence in dynamic flags', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Button = styled.button<{
        active: boolean;
        variant: 'today' | 'time';
      }>\`
        &.active {
          opacity: 1;
        }

        &.variant-today {
          color: white;
        }

        &.variant-time {
          color: green;
        }
      \`;

      function Component({ deadline, useToday, props }) {
        return (
          <>
            <Button
              active={deadline ? isToday(deadline) : false}
              variant={useToday ? 'today' : 'time'}
            >
              Today
            </Button>
            <Button
              {...props}
              active={deadline ? isToday(deadline) : false}
              variant={useToday ? 'today' : 'time'}
            >
              Spread
            </Button>
          </>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { mergeClassNames } from "vindur";
    function Component({ deadline, useToday, props }) {
      return (
        <>
          <button
            className={
              "v1560qbr-1-Button" +
              ((deadline ? isToday(deadline) : false)
                ? " v1560qbr-1-Button-active"
                : "") +
              (useToday
                ? " v1560qbr-1-Button-variant-today"
                : " v1560qbr-1-Button-variant-time")
            }
          >
            Today
          </button>
          <button
            {...props}
            className={
              mergeClassNames([props], "v1560qbr-1-Button") +
              ((deadline ? isToday(deadline) : false)
                ? " v1560qbr-1-Button-active"
                : "") +
              (useToday
                ? " v1560qbr-1-Button-variant-today"
                : " v1560qbr-1-Button-variant-time")
            }
          >
            Spread
          </button>
        </>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      &.v1560qbr-1-Button-active {
        opacity: 1;
      }

      &.v1560qbr-1-Button-variant-today {
        color: white;
      }

      &.v1560qbr-1-Button-variant-time {
        color: green;
      }
    }
    "
  `);
});

test('should merge explicit className with spread props on style flag components', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Flag = styled.div<{ active: boolean }>\`
        color: red;
        &.active { color: blue; }
      \`;

      function Component({ p, x }) {
        return (
          <>
            <Flag className="a" {...p} active={x} />
            <Flag {...p} className="a" active={x} />
          </>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { mergeClassNames } from "vindur";
    function Component({ p, x }) {
      return (
        <>
          <div
            {...p}
            className={
              mergeClassNames(["a", p], "v1560qbr-1-Flag") +
              (x ? " v1560qbr-1-Flag-active" : "")
            }
          />
          <div
            {...p}
            className={"v1560qbr-1-Flag a" + (x ? " v1560qbr-1-Flag-active" : "")}
          />
        </>
      );
    }
    "
  `);
});

test('should keep css nested in className of style flag components with spread props', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, styled } from 'vindur';

      const Box = styled.div<{ active: boolean }>\`
        color: red;
        &.active { color: blue; }
      \`;

      function Component({ props, active }) {
        return <Box {...props} active={active} className={css\`background: green;\`} />;
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ props, active }) {
      return (
        <div
          {...props}
          className={
            "v1560qbr-1-Box " +
            ("v1560qbr-2" || "") +
            (active ? " v1560qbr-1-Box-active" : "")
          }
        />
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      color: red;
      &.v1560qbr-1-Box-active {
        color: blue;
      }
    }

    .v1560qbr-2 {
      background: green;
    }
    "
  `);
});

test('should throw for string union style flag values that are not class name parts', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Box = styled.div<{ size: 'a"b' | 'small' }>\`
          color: red;
        \`;

        export const App = () => <Box size="small" />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "size" value "a"b" must only contain letters, digits, - and _, as it becomes part of a class name
    loc: 3:31]
  `);
});

test('should keep base style flags when an extension declares its own', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      const Base = styled.div<{ active: boolean }>\`
        &.active {
          color: blue;
        }
      \`

      const Ext = styled(Base)<{ big: boolean }>\`
        &.active {
          width: 1px;
        }
        &.big {
          height: 1px;
        }
      \`

      const App = () => <Ext active big />
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const App = () => (
      <div
        className={
          "v1560qbr-1-Base v1560qbr-2-Ext v1560qbr-1-Base-active v1560qbr-2-Ext-big"
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Base {
      &.v1560qbr-1-Base-active {
        color: blue;
      }
    }

    .v1560qbr-2-Ext {
      &.v1560qbr-1-Base-active {
        width: 1px;
      }
      &.v1560qbr-2-Ext-big {
        height: 1px;
      }
    }
    "
  `);
});

test('should only rewrite style flag classes in selectors', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      const Button = styled.div<{ active: boolean }>\`
        background: url('/icons/button.active.svg');
        &::before {
          content: '.active';
        }
        &.active {
          color: blue;
        }
      \`

      const App = () => <Button active />
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      background: url("/icons/button.active.svg");
      &::before {
        content: ".active";
      }
      &.v1560qbr-1-Button-active {
        color: blue;
      }
    }
    "
  `);
});

test('should only rename style flag classes of the element itself', async () => {
  const warnings: TransformWarning[] = [];

  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      const List = styled.ul<{ active: boolean; expanded: boolean }>\`
        &.active { color: blue; }
        & > li.expanded { color: red; }
        .expanded & { color: green; }
      \`

      export const App = () => <List active expanded />
    `,
    onWarning: (warning) => warnings.push(warning),
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-List {
      &.v1560qbr-1-List-active {
        color: blue;
      }
      & > li.expanded {
        color: red;
      }
      .expanded & {
        color: green;
      }
    }
    "
  `);

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: "The style flag class \\"expanded\\" is used in a selector of another element in List, where it is kept as written and doesn't match the flag. Flag classes only apply to the element itself, e.g. \\"&.expanded\\""
        loc: 'current_file:3:6'
    "
  `);
});

test('should read string union flag values picking between strings once', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      const Button = styled.button<{ variant: 'primary' | 'secondary' }>\`
        &.variant-primary { color: white; }
        &.variant-secondary { color: gray; }
      \`

      export const App = ({ id }) => (
        <Button variant={isSelected(id) ? 'primary' : 'secondary'} />
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = ({ id }) => (
      <button
        className={
          "v1560qbr-1-Button" +
          (isSelected(id)
            ? " v1560qbr-1-Button-variant-primary"
            : " v1560qbr-1-Button-variant-secondary")
        }
      />
    );
    "
  `);
});
