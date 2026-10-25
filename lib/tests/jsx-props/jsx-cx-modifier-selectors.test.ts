import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

test('should only rewrite whole cx modifier class names in css', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled, cx } from 'vindur';

      const Box = styled.div\`
        &.active { color: red; }
        &.activeIcon { color: blue; }
      \`;

      function Component({ isActive, hasIcon }) {
        return (
          <>
            <Box cx={{ active: isActive, activeIcon: hasIcon }} />
            <div
              cx={{ active: isActive, activeIcon: hasIcon }}
              css={\`
                &.active { color: red; }
                &.activeIcon { color: blue; }
              \`}
            />
          </>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component({ isActive, hasIcon }) {
      return (
        <>
          <div
            className={
              "v1560qbr-1-Box " +
              cx({
                "v1560qbr-2-active": isActive,
                "v1560qbr-3-activeIcon": hasIcon,
              })
            }
          />
          <div
            className={
              "v1560qbr-4-css-prop-4 " +
              cx({
                "v1560qbr-5-active": isActive,
                "v1560qbr-6-activeIcon": hasIcon,
              })
            }
          />
        </>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      &.v1560qbr-2-active {
        color: red;
      }
      &.v1560qbr-3-activeIcon {
        color: blue;
      }
    }

    .v1560qbr-4-css-prop-4 {
      &.v1560qbr-5-active {
        color: red;
      }
      &.v1560qbr-6-activeIcon {
        color: blue;
      }
    }
    "
  `);
});

test('should warn about cx modifiers only declared as a prefix of another class', async () => {
  const warnings: TransformWarning[] = [];

  await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        &.activeIcon { color: blue; }
      \`;

      function Component({ isActive }) {
        return <Box cx={{ active: isActive }} />;
      }
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#: { message: 'Warning: Missing CSS classes for cx modifiers in Box: active', loc: 'current_file:8:9' }
    "
  `);
});

test('should rewrite every cx modifier class of compound selectors', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        &.active.selected { color: red; }
        &.selected:hover.active { color: blue; }
      \`;

      function Component({ isActive, isSelected }) {
        return <Box cx={{ active: isActive, selected: isSelected }} />;
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component({ isActive, isSelected }) {
      return (
        <div
          className={
            "v1560qbr-1-Box " +
            cx({
              "v1560qbr-2-active": isActive,
              "v1560qbr-3-selected": isSelected,
            })
          }
        />
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      &.v1560qbr-2-active.v1560qbr-3-selected {
        color: red;
      }
      &.v1560qbr-3-selected:hover.v1560qbr-2-active {
        color: blue;
      }
    }
    "
  `);
});

test('should rewrite cx modifier classes after attribute selectors and inside same element pseudo-classes', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        &[data-state="open"].active { color: red; }
        &:not(.hidden).active { color: blue; }
        &:is(.active, .hidden) { top: 0; }
        &:not(.active .hidden) { left: 0; }
        &:has(.active) { right: 0; }
        &:hover.active\\:icon { z-index: 1; }
        &::after { content: "&:hover.active"; }
      \`;

      function Component({ isActive, isHidden }) {
        return <Box cx={{ active: isActive, hidden: isHidden }} />;
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component({ isActive, isHidden }) {
      return (
        <div
          className={
            "v1560qbr-1-Box " +
            cx({
              "v1560qbr-2-active": isActive,
              "v1560qbr-3-hidden": isHidden,
            })
          }
        />
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      &[data-state="open"].v1560qbr-2-active {
        color: red;
      }
      &:not(.v1560qbr-3-hidden).v1560qbr-2-active {
        color: blue;
      }
      &:is(.v1560qbr-2-active, .v1560qbr-3-hidden) {
        top: 0;
      }
      &:not(.active .v1560qbr-3-hidden) {
        left: 0;
      }
      &:has(.active) {
        right: 0;
      }
      &:hover.active\\:icon {
        z-index: 1;
      }
      &::after {
        content: "&:hover.active";
      }
    }
    "
  `);
});

test('should leave commented selector parts intact', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        &:is([data-x=foo/*)*/].active) { color: green; }
        &.active { color: red; }
      \`;

      export const App = ({ a }) => <Box cx={{ active: a }} />;
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      &:is([data-x=foo/*)*/].v1560qbr-2-active) {
        color: green;
      }
      &.v1560qbr-2-active {
        color: red;
      }
    }
    "
  `);
});

test('should rewrite cx classes after type and id selectors', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Item = styled.div\`
        &:not(div.active) { opacity: 0.5; }
        &:is(*.active, #main.active) { color: red; }
        &#main.active { color: blue; }
      \`;

      export const App = ({ a }) => <Item cx={{ active: a }} />;
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Item {
      &:not(div.v1560qbr-2-active) {
        opacity: 0.5;
      }
      &:is(*.v1560qbr-2-active, #main.v1560qbr-2-active) {
        color: red;
      }
      &#main.v1560qbr-2-active {
        color: blue;
      }
    }
    "
  `);
});

test('should rewrite nested & compounds and the of selector list of nth-child', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Item = styled.div\`
        &:not(&.active) { opacity: 0.5; }
        &:is(.list &.active) { color: red; }
        &:has(&.active > .icon) { color: blue; }
        &:nth-child(2n+1 of .active, .hidden) { top: 0; }
        &:nth-child(2n+1) .active { left: 0; }
      \`;

      export const App = ({ a, h }) => <Item cx={{ active: a, hidden: h }} />;
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Item {
      &:not(&.v1560qbr-2-active) {
        opacity: 0.5;
      }
      &:is(.list &.v1560qbr-2-active) {
        color: red;
      }
      &:has(&.v1560qbr-2-active > .icon) {
        color: blue;
      }
      &:nth-child(2n + 1 of .v1560qbr-2-active, .v1560qbr-3-hidden) {
        top: 0;
      }
      &:nth-child(2n + 1) .active {
        left: 0;
      }
    }
    "
  `);
});

test('should only rewrite cx classes of selectors that match the styled element', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        &:has(.child:not(.active)) { color: red; }
        & .tab { &.active { color: blue; } }
        .dark & { &.active { color: green; } }
        &:hover { &.active { top: 0; } }
        @media (min-width: 1px) { &.active { left: 0; } }
        .active& { right: 0; }
        &:IS(.active), &:Not(.active) { bottom: 0; }
      \`;

      export const App = ({ a }) => <Box cx={{ active: a }} />;
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      &:has(.child:not(.active)) {
        color: red;
      }
      & .tab {
        &.active {
          color: blue;
        }
      }
      .dark & {
        &.v1560qbr-2-active {
          color: green;
        }
      }
      &:hover {
        &.v1560qbr-2-active {
          top: 0;
        }
      }
      @media (min-width: 1px) {
        &.v1560qbr-2-active {
          left: 0;
        }
      }
      .v1560qbr-2-active& {
        right: 0;
      }
      &:is(.v1560qbr-2-active),
      &:not(.v1560qbr-2-active) {
        bottom: 0;
      }
    }
    "
  `);
});

test('should only rewrite css prop cx classes that match the element', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const App = ({ a }) => (
        <div
          css={\`
            & .tab { &.on { color: red; } }
            &.on { color: blue; }
          \`}
          cx={{ on: a }}
        />
      );
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-css-prop-1 {
      & .tab {
        &.on {
          color: red;
        }
      }
      &.v1560qbr-2-on {
        color: blue;
      }
    }
    "
  `);
});

test('should warn about cx modifiers only declared for another element', async () => {
  const warnings: TransformWarning[] = [];

  await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        & .tab { &.selected { color: blue; } }
      \`;

      export const App = ({ a }) => <Box cx={{ selected: a }} />;
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: 'Warning: Missing CSS classes for cx modifiers in Box: selected'
        loc: 'current_file:7:30'
    "
  `);
});

test('should keep rewriting cx classes of nested rules that may match the styled element', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        /* responsive */ @media (min-width: 1px) { &.active { left: 0; } }
        :is(&) { &.active { top: 0; } }
        &:hover, & .child { &.active { color: red; } }
        & /* note */ .tab { &.active { color: blue; } }
        &:hover /* note */ { &.active { right: 0; } }
      \`;

      export const App = ({ a }) => <Box cx={{ active: a }} />;
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      /* responsive */
      @media (min-width: 1px) {
        &.v1560qbr-2-active {
          left: 0;
        }
      }
      :is(&) {
        &.v1560qbr-2-active {
          top: 0;
        }
      }
      &:hover,
      & .child {
        &.v1560qbr-2-active {
          color: red;
        }
      }
      & /* note */ .tab {
        &.active {
          color: blue;
        }
      }
      &:hover /* note */ {
        &.v1560qbr-2-active {
          right: 0;
        }
      }
    }
    "
  `);
});

test('should rewrite cx classes in @scope preludes, layers, commented compounds and hex escapes', async () => {
  const warnings: TransformWarning[] = [];

  const result = await transformWithFormat({
    source: dedent`
      import { styled, layer } from 'vindur';

      const Box = styled.div\`
        @scope (&.active) to (&.done .stop) { & { color: red; } }
        & a[href*="&"] { &:not(.disabled) { color: green; } }
        &/* c */.active { top: 0; }
        &.active/* c */.done { left: 0; }
        &.a\\63 tive { right: 0; }
        \${layer('base')} { &.done { margin: 0; } }
      \`;

      export const App = ({ a, b, c }) => (
        <Box cx={{ active: a, disabled: b, done: c }} />
      );
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      @scope (&.v1560qbr-2-active) to (&.v1560qbr-4-done .stop) {
        & {
          color: red;
        }
      }
      & a[href*="&"] {
        &:not(.disabled) {
          color: green;
        }
      }
      &/* c */.v1560qbr-2-active {
        top: 0;
      }
      &.v1560qbr-2-active/* c */.v1560qbr-4-done {
        left: 0;
      }
      &.v1560qbr-2-active {
        right: 0;
      }
    }

    @layer base {
      .v1560qbr-1-Box {
        &.v1560qbr-4-done {
          margin: 0;
        }
      }
    }
    "
  `);

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: 'Warning: Missing CSS classes for cx modifiers in Box: disabled'
        loc: 'current_file:13:2'
    "
  `);
});

test('should rewrite uppercase of and scoped roots on the styled element', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        &:nth-child(2n OF .active) { top: 0; }
        @scope (& .child) { &.active { left: 0; } }
        @scope (&.active) { & { right: 0; } }
      \`;

      export const App = ({ b }) => <Box cx={{ active: b }} />;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const App = ({ b }) => (
      <div
        className={
          "v1560qbr-1-Box " +
          cx({
            "v1560qbr-2-active": b,
          })
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      &:nth-child(2n OF .v1560qbr-2-active) {
        top: 0;
      }
      @scope (& .child) {
        &.active {
          left: 0;
        }
      }
      @scope (&.v1560qbr-2-active) {
        & {
          right: 0;
        }
      }
    }
    "
  `);
});

test('should leave cx classes of relative nested rules and rewrite rootless and escaped @scope', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        .tab { &.active { color: red; } }
        > .icon { &.active { color: blue; } }
        @scope to (& .stop) { &.active { color: green; } }
        @sc\\6f pe (&.active) { & { top: 0; } }
      \`;

      export const App = ({ a }) => <Box cx={{ active: a }} />;
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      .tab {
        &.active {
          color: red;
        }
      }
      > .icon {
        &.active {
          color: blue;
        }
      }
      @scope to (& .stop) {
        &.v1560qbr-2-active {
          color: green;
        }
      }
      @sc \\6f pe (&.v1560qbr-2-active) {
        & {
          top: 0;
        }
      }
    }
    "
  `);
});

test('should rewrite cx modifiers in every selector of the element', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        &.active.disabled {
          color: red;
        }
        &.active, &:focus-visible.disabled {
          color: blue;
        }
        .parent &.active {
          color: green;
        }
        &:not(.active) {
          opacity: 0.5;
        }
        &:is(.active, .disabled):where(.theme .active) {
          outline: none;
        }
        &:hover {
          &.active {
            color: orange;
          }
        }
        @media (min-width: 600px) {
          &.active {
            color: purple;
          }
        }
      \`;

      export const App = ({ on }: { on: boolean }) => (
        <Box cx={{ active: on, disabled: !on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const App = ({ on }: { on: boolean }) => (
      <div
        className={
          "v1560qbr-1-Box " +
          cx({
            "v1560qbr-2-active": on,
            "v1560qbr-3-disabled": !on,
          })
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      &.v1560qbr-2-active.v1560qbr-3-disabled {
        color: red;
      }
      &.v1560qbr-2-active,
      &:focus-visible.v1560qbr-3-disabled {
        color: blue;
      }
      .parent &.v1560qbr-2-active {
        color: green;
      }
      &:not(.v1560qbr-2-active) {
        opacity: 0.5;
      }
      &:is(.v1560qbr-2-active, .v1560qbr-3-disabled):where(
          .theme .v1560qbr-2-active
        ) {
        outline: none;
      }
      &:hover {
        &.v1560qbr-2-active {
          color: orange;
        }
      }
      @media (min-width: 600px) {
        &.v1560qbr-2-active {
          color: purple;
        }
      }
    }
    "
  `);
});

test('should keep classes of other elements when rewriting cx modifiers', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        --label: &.active;
        content: "&.active";
        /* &.active */
        &.active {
          color: red;
        }
        & .active, & + .active {
          color: blue;
        }
        &:has(.active) {
          color: green;
        }
        & .child {
          &.active {
            color: orange;
          }
        }
        &:hover, & .child {
          &.active {
            color: purple;
          }
        }
      \`;

      export const App = ({ on }: { on: boolean }) => <Box cx={{ active: on }} />;
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      --label: &.active;
      content: "&.active";
      /* &.active */
      &.v1560qbr-2-active {
        color: red;
      }
      & .active,
      & + .active {
        color: blue;
      }
      &:has(.active) {
        color: green;
      }
      & .child {
        &.active {
          color: orange;
        }
      }
      &:hover,
      & .child {
        &.active {
          color: purple;
        }
      }
    }
    "
  `);
});

test('should rewrite cx modifiers in layers of the css prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { layer } from 'vindur';

      export const App = ({ on }: { on: boolean }) => (
        <div
          css={\`
            \${layer('base')} {
              &:not(.active) {
                opacity: 0.5;
              }
            }
            & .active {
              color: red;
            }
          \`}
          cx={{ active: on }}
        />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const App = ({ on }: { on: boolean }) => (
      <div
        className={
          "v1560qbr-1-css-prop-1 " +
          cx({
            "v1560qbr-2-active": on,
          })
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    "@layer base {
      .v1560qbr-1-css-prop-1 {
        &:not(.v1560qbr-2-active) {
          opacity: 0.5;
        }
      }
    }

    .v1560qbr-1-css-prop-1 {
      & .active {
        color: red;
      }
    }
    "
  `);
});

test('should rewrite cx modifiers in pseudo classes of css references', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';

      const card = css\`
        &:where(.selected) {
          color: red;
        }
        & .selected {
          color: blue;
        }
      \`;

      export const App = ({ on }: { on: boolean }) => (
        <div className={card} cx={{ selected: on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    const card = "v1560qbr-1-card";
    export const App = ({ on }: { on: boolean }) => (
      <div
        className={
          card +
          " " +
          cx({
            "v1560qbr-2-selected": on,
          })
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-card {
      &:where(.v1560qbr-2-selected) {
        color: red;
      }
      & .selected {
        color: blue;
      }
    }
    "
  `);
});
