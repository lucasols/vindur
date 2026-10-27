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
    "import { mergeClassNames } from "vindur";
    function Component({ props }) {
      return (
        <button
          {...props}
          className={mergeClassNames([props], "v1560qbr-1-Button voctcyj-active")}
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
    "import { mergeClassNames } from "vindur";
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
            className={mergeClassNames(
              [props],
              "v1560qbr-1-Button" +
                ((deadline ? isToday(deadline) : false) ? " voctcyj-active" : "") +
                ((useToday ? "today" : "time")
                  ? " v11as9cs-variant-" + (useToday ? "today" : "time")
                  : ""),
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
    "import { mergeClassNames } from "vindur";
    function Component({ p, x }) {
      return (
        <>
          <div
            {...p}
            className={mergeClassNames(
              ["a", p],
              "v1560qbr-1-Flag" + (x ? " voctcyj-active" : ""),
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
        className={"v1560qbr-1-Base v1560qbr-2-Ext voctcyj-active v1x4k6wd-big"}
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Base {
      &.voctcyj-active {
        color: blue;
      }
    }

    .v1560qbr-2-Ext {
      &.voctcyj-active {
        width: 1px;
      }
      &.v1x4k6wd-big {
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
      &.voctcyj-active {
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
      &.voctcyj-active {
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
        message: 'Warning: Missing modifier styles for "&.expanded" in List'
        loc: 'current_file:3:6'
    "
  `);
});
