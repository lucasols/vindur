import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should hash modifier class names in dev mode', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Widget = styled.div<{
        active: boolean;
        featured: boolean;
      }>\`
        background: white;

        &.active {
          background: blue;
        }

        &.featured {
          border: 2px solid gold;
        }
      \`;

      function Component() {
        return (
          <Widget active={true} featured={false}>
            Content
          </Widget>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component() {
      return <div className={"v1560qbr-1-Widget voctcyj-active"}>Content</div>;
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Widget {
      background: white;

      &.voctcyj-active {
        background: blue;
      }

      &.vnwmeu-featured {
        border: 2px solid gold;
      }
    }
    "
  `);
});

test('should hash modifier class names without suffix in production mode', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Widget = styled.div<{
        active: boolean;
        featured: boolean;
      }>\`
        background: white;

        &.active {
          background: blue;
        }

        &.featured {
          border: 2px solid gold;
        }
      \`;

      function Component() {
        return (
          <Widget active={true} featured={false}>
            Content
          </Widget>
        );
      }
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component() {
      return <div className={"v1560qbr-1 voctcyj"}>Content</div>;
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      background: white;

      &.voctcyj {
        background: blue;
      }

      &.vnwmeu {
        border: 2px solid gold;
      }
    }
    "
  `);
});

test('referencing styled component with flags preserves style flag hash', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Child2 = styled.div\`
        border: 1px solid gray;
        padding: 16px;

        \${() => Container}.active & {
          border-left: 4px solid orange;
        }
      \`;

      const Container = styled.div<{
        active: boolean;
      }>\`
        padding: 8px;
        background: white;

        &.active {
          background: yellow;
          font-weight: bold;
        }
      \`;

      const Child = styled.div\`
        border: 1px solid gray;
        padding: 16px;

        \${Container}.active & {
          border-left: 4px solid orange;
        }
      \`;

      function Component({ active }: { active: boolean }) {
        return (
          <Container active={active}>
            <Child2 />
            <Child>
              Child
            </Child>
          </Container>
        );
      }
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ active }: { active: boolean }) {
      return (
        <div className={"v1560qbr-2" + (active ? " voctcyj" : "")}>
          <div className="v1560qbr-1" />
          <div className="v1560qbr-3">Child</div>
        </div>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      border: 1px solid gray;
      padding: 16px;

      .v1560qbr-2.voctcyj & {
        border-left: 4px solid orange;
      }
    }

    .v1560qbr-2 {
      padding: 8px;
      background: white;

      &.voctcyj {
        background: yellow;
        font-weight: bold;
      }
    }

    .v1560qbr-3 {
      border: 1px solid gray;
      padding: 16px;

      .v1560qbr-2.voctcyj & {
        border-left: 4px solid orange;
      }
    }
    "
  `);
});

test('referencing styled component flags only hashes whole class names', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Item = styled.div<{ active: boolean }>\`
        &.active {
          color: red;
        }
      \`;

      const Child = styled.div\`
        \${Item}.active-icon & {
          color: green;
        }
        \${Item}.active & {
          color: blue;
        }
      \`;

      export const App = () => (
        <Item active>
          <Child />
        </Item>
      );
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = () => (
      <div className={"v1560qbr-1 voctcyj"}>
        <div className="v1560qbr-2" />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      &.voctcyj {
        color: red;
      }
    }

    .v1560qbr-2 {
      .v1560qbr-1.active-icon & {
        color: green;
      }
      .v1560qbr-1.voctcyj & {
        color: blue;
      }
    }
    "
  `);
});

test('referencing styled component flags hashes every flag of the referenced element', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Item = styled.div<{ active: boolean; size: 'small' | 'large' }>\`
        &.active {
          color: red;
        }
        &.size-small {
          color: red;
        }
        &.size-large {
          color: red;
        }
      \`;

      const Child = styled.div\`
        \${Item}.size-small.active & {
          color: green;
        }
        \${Item}:hover.active & {
          color: blue;
        }
        \${Item}:not(.active) & {
          color: gray;
        }
        \${Item}:has(.active) & {
          color: black;
        }
      \`;

      export const App = () => (
        <Item active size="small">
          <Child />
        </Item>
      );
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = () => (
      <div className={"v1560qbr-1 voctcyj vr4ikfs-small"}>
        <div className="v1560qbr-2" />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      &.voctcyj {
        color: red;
      }
      &.vr4ikfs-small {
        color: red;
      }
      &.vr4ikfs-large {
        color: red;
      }
    }

    .v1560qbr-2 {
      .v1560qbr-1.vr4ikfs-small.voctcyj & {
        color: green;
      }
      .v1560qbr-1:hover.voctcyj & {
        color: blue;
      }
      .v1560qbr-1:not(.voctcyj) & {
        color: gray;
      }
      .v1560qbr-1:has(.active) & {
        color: black;
      }
    }
    "
  `);
});

test('should support style flags with $ prefixed names', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Widget = styled.div<{
        $active: boolean;
        $size: 'small' | 'large';
      }>\`
        background: white;

        &.$active {
          background: blue;
        }

        &.$size-small {
          padding: 4px;
        }

        &.$size-large {
          padding: 16px;
        }
      \`;

      function Component() {
        return <Widget $active $size="small" />;
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component() {
      return (
        <div className={"v1560qbr-1-Widget v1ytfoaf-_active vh12jjb-_size-small"} />
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Widget {
      background: white;

      &.v1ytfoaf-_active {
        background: blue;
      }

      &.vh12jjb-_size-small {
        padding: 4px;
      }

      &.vh12jjb-_size-large {
        padding: 16px;
      }
    }
    "
  `);
});

test('referencing styled component flags hashes flags of nested and scoped references', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Item = styled.div<{ active: boolean }>\`
        &.active {
          color: red;
        }
      \`;

      const Child = styled.div\`
        :is(\${Item}).active & {
          color: green;
        }
        .list \${Item} {
          &.active .icon {
            color: blue;
          }
          & .active {
            color: gray;
          }
        }
        @scope (\${Item}) {
          :scope.active & {
            color: black;
          }
        }
      \`;

      export const App = () => (
        <Item active>
          <Child />
        </Item>
      );
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = () => (
      <div className={"v1560qbr-1 voctcyj"}>
        <div className="v1560qbr-2" />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      &.voctcyj {
        color: red;
      }
    }

    .v1560qbr-2 {
      :is(.v1560qbr-1).voctcyj & {
        color: green;
      }
      .list .v1560qbr-1 {
        &.voctcyj .icon {
          color: blue;
        }
        & .active {
          color: gray;
        }
      }
      @scope (.v1560qbr-1) {
        :scope.voctcyj & {
          color: black;
        }
      }
    }
    "
  `);
});

test('should throw for referenced styled component flags in rules that also match other elements', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Item = styled.div<{ active: boolean }>\`
          &.active {
            color: red;
          }
        \`;

        const Child = styled.div\`
          \${Item}, .other {
            &.active & {
              color: blue;
            }
          }
        \`;

        export const App = () => (
          <Item active>
            <Child />
          </Item>
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "active" of "Item" can't be used in a rule that matches both "Item" and other elements, like "&.active" nested in "\${Item}, .x". Split the selectors into separate rules.
    loc: 9:6]
  `);
});

test('should throw for $ prefixed flags selected through a component reference', async () => {
  const source = (childFlags: string, rule: string) => dedent`
    import { styled } from 'vindur';

    const Item = styled.div<{ $active: boolean }>\`
      &.$active {
        color: red;
      }
    \`;

    const Child = styled.div${childFlags}\`
      ${rule}
    \`;

    export const App = () => (
      <Item $active>
        <Child />
      </Item>
    );
  `;

  await expect(
    transformWithFormat({
      source: source('', '${Item}.$active & { color: blue; }'),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "$active" can't be selected through a component reference like "\${Item}.$active", use a flag without "$"
    loc: 10:10]
  `);

  await expect(
    transformWithFormat({
      source: source(
        '<{ $active: boolean }>',
        '&.$active { color: red; } ${Item}.$active & { color: blue; }',
      ),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "$active" can't be selected through a component reference like "\${Item}.$active", use a flag without "$"
    loc: 10:36]
  `);

  await expect(
    transformWithFormat({
      source: source('', '${Item} { &.$active & { color: blue; } }'),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "$active" can't be selected through a component reference like "\${Item}.$active", use a flag without "$"
    loc: 10:14]
  `);
});

test('extending a styled component with flags keeps its flags', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Item = styled.div<{ active: boolean }>\`
        &.active {
          color: red;
        }
      \`;

      const Ext = styled(Item)<{ big: boolean }>\`
        &.big {
          font-size: 2em;
        }
        &.active {
          color: blue;
        }
      \`;

      const Child = styled.div\`
        \${Item}.active & {
          color: green;
        }
      \`;

      export const App = () => (
        <Ext active big>
          <Child />
        </Ext>
      );
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = () => (
      <div className={"v1560qbr-1 v1560qbr-2 voctcyj v1x4k6wd"}>
        <div className="v1560qbr-3" />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      &.voctcyj {
        color: red;
      }
    }

    .v1560qbr-2 {
      &.v1x4k6wd {
        font-size: 2em;
      }
      &.voctcyj {
        color: blue;
      }
    }

    .v1560qbr-3 {
      .v1560qbr-1.voctcyj & {
        color: green;
      }
    }
    "
  `);
});

test('referencing a withComponent of an extended component selects its own class', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Base = styled.div\`
        color: red;
      \`;

      const Extended = styled(Base)<{ active: boolean }>\`
        &.active {
          color: blue;
        }
      \`;

      const Link = Extended.withComponent('a');

      const Child = styled.div\`
        \${Link}.active & {
          color: green;
        }
      \`;

      export const App = () => (
        <Link active>
          <Child />
        </Link>
      );
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = () => (
      <a className={"v1560qbr-1 v1560qbr-2 voctcyj"}>
        <div className="v1560qbr-3" />
      </a>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      color: red;
    }

    .v1560qbr-2 {
      &.voctcyj {
        color: blue;
      }
    }

    .v1560qbr-3 {
      .v1560qbr-2.voctcyj & {
        color: green;
      }
    }
    "
  `);
});
