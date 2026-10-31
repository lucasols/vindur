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
    "export const App = ({ on }: { on: boolean }) => (
      <div
        className={
          "v1560qbr-1-Box" +
          (on ? " v1560qbr-2-active" : "") +
          (!on ? " v1560qbr-3-disabled" : "")
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
    "export const App = ({ on }: { on: boolean }) => (
      <div
        className={
          "v1560qbr-1-Box" +
          (on ? " v1560qbr-2-active" : "") +
          (!on ? " v1560qbr-3-disabled" : "")
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
    "export const App = ({ on }: { on: boolean }) => (
      <div className={"v1560qbr-1-css-prop-1" + (on ? " v1560qbr-2-active" : "")} />
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
    "const card = "v1560qbr-1-card";
    export const App = ({ on }: { on: boolean }) => (
      <div className={card + (on ? " v1560qbr-2-selected" : "")} />
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
    "export const App = ({ on }: { on: boolean }) => (
      <div
        className={
          "v1560qbr-1-Box" +
          (on ? " v1560qbr-2-active" : "") +
          (!on ? " v1560qbr-3-disabled" : "")
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

test('should reject cx modifiers in rules matching both the element and other elements', async () => {
  const styled = (selector: string) => dedent`
    import { styled } from 'vindur';

    const Box = styled.div\`
      ${selector} { &.active { color: red; } }
      &:hover, & .child { &.other { color: blue; } }
    \`;

    export const App = ({ on }: { on: boolean }) => <Box cx={{ active: on }} />;
  `;

  await expect(transformWithFormat({ source: styled('&:hover, & .child') }))
    .rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop class "active" can't be hashed in a rule that matches both the element and other elements, like "&.active" nested in "&:hover, & .child" or ":where(&, .x)". Split the selectors into separate rules or use a $-prefixed class (e.g. $active).
    loc: 8:59]
  `);

  await expect(transformWithFormat({ source: styled(':where(&, .x)') })).rejects
    .toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop class "active" can't be hashed in a rule that matches both the element and other elements, like "&.active" nested in "&:hover, & .child" or ":where(&, .x)". Split the selectors into separate rules or use a $-prefixed class (e.g. $active).
    loc: 8:59]
  `);

  await expect(transformWithFormat({ source: styled('@scope (&, & .x)') }))
    .rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop class "active" can't be hashed in a rule that matches both the element and other elements, like "&.active" nested in "&:hover, & .child" or ":where(&, .x)". Split the selectors into separate rules or use a $-prefixed class (e.g. $active).
    loc: 8:59]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        export const App = ({ on }: { on: boolean }) => (
          <div css={\`&:hover, & .child { &.active { color: red; } }\`} cx={{ active: on }} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop class "active" can't be hashed in a rule that matches both the element and other elements, like "&.active" nested in "&:hover, & .child" or ":where(&, .x)". Split the selectors into separate rules or use a $-prefixed class (e.g. $active).
    loc: 2:12]
  `);
});

test('should reject cx modifiers declared by an extended styled component', async () => {
  const source = (child: string) => dedent`
    import { styled } from 'vindur';

    const Base = styled.div\`
      &.active { color: red; }
    \`;

    const Child = styled(Base)\`
      padding: 0;
    \`;

    export const App = ({ on }: { on: boolean }) => (
      <>
        <Base cx={{ active: on }} />
        <Child cx={{ ${child}: on }} />
      </>
    );
  `;

  await expect(transformWithFormat({ source: source('active') })).rejects
    .toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop class "active" can't be hashed on styled component "Child", its "&.active" styles are declared in the styled component it extends. Move the modifier styles into "Child" or use a $-prefixed class (e.g. $active).
    loc: 14:17]
  `);

  await expect(transformWithFormat({ source: source('$active') })).rejects
    .toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop class "active" is used both hashed and as "$active" with the same styles, hashing renames their "&.active" selectors so "$active" would stop matching. Use the same key in all cx props of these styles.
    loc: 14:17]
  `);
});

test('should reject hashed cx modifiers selected through a component reference', async () => {
  const source = (selector: string) => dedent`
    import { styled } from 'vindur';

    const Item = styled.li\`
      &.active { color: blue; }
    \`;

    const List = styled.ul\`
      ${selector} { font-weight: bold; }
    \`;

    export const App = ({ on }: { on: boolean }) => (
      <List>
        <Item cx={{ active: on }} />
      </List>
    );
  `;

  await expect(transformWithFormat({ source: source('& ${Item}.active') }))
    .rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop class "active" can't be hashed on styled component "Item", other styles select it through a component reference, like "\${Item}.active", which would stop matching. Use a $-prefixed class (e.g. $active) or a style flag.
    loc: 13:16]
  `);

  await expect(
    transformWithFormat({ source: source('& ${() => Item}:not(.active)') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop class "active" can't be hashed on styled component "Item", other styles select it through a component reference, like "\${Item}.active", which would stop matching. Use a $-prefixed class (e.g. $active) or a style flag.
    loc: 13:16]
  `);
});

test('should keep classes of other elements selected with a component reference', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Item = styled.li\`
        &.active { color: blue; }
      \`;

      const List = styled.ul\`
        & \${Item} .active, &.active \${Item} { font-weight: bold; }
      \`;

      export const App = ({ on }: { on: boolean }) => (
        <List>
          <Item cx={{ active: on }} />
        </List>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = ({ on }: { on: boolean }) => (
      <ul className="v1560qbr-2-List">
        <li className={"v1560qbr-1-Item" + (on ? " v1560qbr-3-active" : "")} />
      </ul>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Item {
      &.v1560qbr-3-active {
        color: blue;
      }
    }

    .v1560qbr-2-List {
      & .v1560qbr-1-Item .active,
      &.active .v1560qbr-1-Item {
        font-weight: bold;
      }
    }
    "
  `);
});
