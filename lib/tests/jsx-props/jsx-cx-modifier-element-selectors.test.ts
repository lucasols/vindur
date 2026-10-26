import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

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

test('should rewrite cx modifiers nested in selector arguments and scope roots', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        :where(&.active) {
          color: red;
        }
        &:nth-child(1 of .active) {
          color: blue;
        }
        @scope (&.active) {
          &.disabled {
            color: green;
          }
        }
        @scope (.child) {
          &.active {
            color: orange;
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
      :where(&.v1560qbr-2-active) {
        color: red;
      }
      &:nth-child(1 of .v1560qbr-2-active) {
        color: blue;
      }
      @scope (&.v1560qbr-2-active) {
        &.v1560qbr-3-disabled {
          color: green;
        }
      }
      @scope (.child) {
        &.active {
          color: orange;
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

test('should rewrite cx modifiers in @scope limits and :scope selectors', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        @scope (&) to (&.active > *) {
          :scope.disabled {
            color: red;
          }
        }

        @scope (.child) {
          :scope.active {
            color: blue;
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
      @scope (&) to (&.v1560qbr-2-active > *) {
        :scope.v1560qbr-3-disabled {
          color: red;
        }
      }

      @scope (.child) {
        :scope.active {
          color: blue;
        }
      }
    }
    "
  `);
});

test('should reject --- prefixed cx keys', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        export const App = ({ on }: { on: boolean }) => (
          <div css={\`&.---active { color: red; }\`} cx={{ '---active': on }} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop key "---active" must not start with ---, which is reserved for scoped variables, eg. { active: on }
    loc: 2:49]
  `);
});
