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
        <button className={"v1560qbr-1-Button extra-class v1puiack-primary"}>
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
    "function Component({ isActive, buttonSize }) {
      return (
        <button
          className={
            "v1560qbr-1-Button" +
            (isActive ? " voctcyj-active" : "") +
            (buttonSize ? " vr4ikfs-size-" + buttonSize : "")
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
    "import { cx, mergeClassNames } from "vindur";
    function Component({ deadline, useToday, props }) {
      return (
        <>
          <button
            className={
              "v1560qbr-1-Button" +
              ((deadline ? isToday(deadline) : false) ? " voctcyj-active" : "") +
              ((useToday ? "today" : "time")
                ? " v11as9cs-variant-" + (useToday ? "today" : "time")
                : "")
            }
          >
            Today
          </button>
          <button
            {...props}
            className={cx(
              mergeClassNames([props], "v1560qbr-1-Button"),
              (deadline ? isToday(deadline) : false) && "voctcyj-active",
              (useToday ? "today" : "time") &&
                \`v11as9cs-variant-\${useToday ? "today" : "time"}\`,
            )}
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
      &.voctcyj-active {
        opacity: 1;
      }

      &.v11as9cs-variant-today {
        color: white;
      }

      &.v11as9cs-variant-time {
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
    "import { cx, mergeClassNames } from "vindur";
    function Component({ p, x }) {
      return (
        <>
          <div
            {...p}
            className={cx(
              mergeClassNames(["a", p], "v1560qbr-1-Flag"),
              x && "voctcyj-active",
            )}
          />
          <div
            {...p}
            className={"v1560qbr-1-Flag a" + (x ? " voctcyj-active" : "")}
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
            (active ? " voctcyj-active" : "")
          }
        />
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      color: red;
      &.voctcyj-active {
        color: blue;
      }
    }

    .v1560qbr-2 {
      background: green;
    }
    "
  `);
});

test('should escape and decode string union style flag values in class names', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div<{ size: 'a"b' | 'x&y' }>\`
        color: red;
      \`;

      export const App = ({ c }) => (
        <>
          <Box size={'a"b'} />
          <Box size="x&amp;y" className="c" />
          <Box size={'a"b'} className={c} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = ({ c }) => (
      <>
        <div className={'v1560qbr-1-Box vr4ikfs-size-a"b'} />
        <div className={"v1560qbr-1-Box c vr4ikfs-size-x&y"} />
        <div className={"v1560qbr-1-Box " + (c || "") + ' vr4ikfs-size-a"b'} />
      </>
    );
    "
  `);
});
