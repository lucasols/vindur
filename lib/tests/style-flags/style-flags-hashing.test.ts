import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

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
      return (
        <div className={"v1560qbr-1-Widget v1560qbr-1-Widget-active"}>Content</div>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Widget {
      background: white;

      &.v1560qbr-1-Widget-active {
        background: blue;
      }

      &.v1560qbr-1-Widget-featured {
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
      return <div className={"v1560qbr-1 vmabrr"}>Content</div>;
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      background: white;

      &.vmabrr {
        background: blue;
      }

      &.vxwlrrj {
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
        <div className={"v1560qbr-2" + (active ? " v1exp0sy" : "")}>
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

      .v1560qbr-2.v1exp0sy & {
        border-left: 4px solid orange;
      }
    }

    .v1560qbr-2 {
      padding: 8px;
      background: white;

      &.v1exp0sy {
        background: yellow;
        font-weight: bold;
      }
    }

    .v1560qbr-3 {
      border: 1px solid gray;
      padding: 16px;

      .v1560qbr-2.v1exp0sy & {
        border-left: 4px solid orange;
      }
    }
    "
  `);
});

test('should reject style flags with $ prefixed names', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Widget = styled.div<{
          $active: boolean;
        }>\`
          &.$active {
            background: blue;
          }
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag \`$active\` can't start with \`$\`, style flags are never passed to the DOM, so use \`active\`
    loc: 4:2]
  `);
});

test('should hash every style flag of a compound component reference', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      const Button = styled.button<{ active: boolean; size: 'small' | 'large' }>\`
        &.active { color: red; }
        &.size-large { padding: 8px; }
      \`

      const Toolbar = styled.div\`
        \${Button}.active.size-large { color: blue; }
        \${Button}.size-large.other.active { color: green; }
      \`

      export const App = ({ on }) => (
        <Toolbar>
          <Button active={on} size="large" />
        </Toolbar>
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = ({ on }) => (
      <div className="v1560qbr-2-Toolbar">
        <button
          className={
            "v1560qbr-1-Button v1560qbr-1-Button-size-large" +
            (on ? " v1560qbr-1-Button-active" : "")
          }
        />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      &.v1560qbr-1-Button-active {
        color: red;
      }
      &.v1560qbr-1-Button-size-large {
        padding: 8px;
      }
    }

    .v1560qbr-2-Toolbar {
      .v1560qbr-1-Button.v1560qbr-1-Button-active.v1560qbr-1-Button-size-large {
        color: blue;
      }
      .v1560qbr-1-Button.v1560qbr-1-Button-size-large.other.v1560qbr-1-Button-active {
        color: green;
      }
    }
    "
  `);
});

test('should hash flag classes after a repeated component reference', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      const Button = styled.div<{ active: boolean }>\`
        &.active { color: red; }
      \`
      const Wrapper = styled.div\`
        \${Button}\${Button}.active { color: blue; }
      \`
      export const App = () => <Wrapper><Button active /></Wrapper>
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = () => (
      <div className="v1560qbr-2-Wrapper">
        <div className={"v1560qbr-1-Button v1560qbr-1-Button-active"} />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      &.v1560qbr-1-Button-active {
        color: red;
      }
    }

    .v1560qbr-2-Wrapper {
      .v1560qbr-1-Button.v1560qbr-1-Button.v1560qbr-1-Button-active {
        color: blue;
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
      <div className={"v1560qbr-1 vmabrr"}>
        <div className="v1560qbr-2" />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      &.vmabrr {
        color: red;
      }
    }

    .v1560qbr-2 {
      .v1560qbr-1.active-icon & {
        color: green;
      }
      .v1560qbr-1.vmabrr & {
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
      <div className={"v1560qbr-1 vmabrr v16ujyv9-small"}>
        <div className="v1560qbr-2" />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      &.vmabrr {
        color: red;
      }
      &.v16ujyv9-small {
        color: red;
      }
      &.v16ujyv9-large {
        color: red;
      }
    }

    .v1560qbr-2 {
      .v1560qbr-1.v16ujyv9-small.vmabrr & {
        color: green;
      }
      .v1560qbr-1:hover.vmabrr & {
        color: blue;
      }
      .v1560qbr-1:not(.vmabrr) & {
        color: gray;
      }
      .v1560qbr-1:has(.active) & {
        color: black;
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
      <div className={"v1560qbr-1 vmabrr"}>
        <div className="v1560qbr-2" />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      &.vmabrr {
        color: red;
      }
    }

    .v1560qbr-2 {
      :is(.v1560qbr-1).vmabrr & {
        color: green;
      }
      .list .v1560qbr-1 {
        &.vmabrr .icon {
          color: blue;
        }
        & .active {
          color: gray;
        }
      }
      @scope (.v1560qbr-1) {
        :scope.vmabrr & {
          color: black;
        }
      }
    }
    "
  `);
});

test('referencing imported styled component flags hashes them as the component module does', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { Item } from '#/item';

      const Child = styled.div\`
        \${Item}.active & {
          color: green;
        }
        .list \${Item} {
          &.size-small .icon {
            color: blue;
          }
        }
      \`;

      export const App = () => (
        <Item active size="small">
          <Child />
        </Item>
      );
    `,
    overrideDefaultFs: createFsMock({
      'item.tsx': dedent`
        import { styled } from 'vindur';

        export const Item = styled.div<{ active: boolean; size: 'small' | 'large' }>\`
          &.active {
            color: red;
          }
          &.size-small {
            padding: 4px;
          }
        \`;
      `,
    }),
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { Item } from "#/item";
    export const App = () => (
      <Item active size="small">
        <div className="v1560qbr-1" />
      </Item>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      .v1llrsih-1.vxyl5e & {
        color: green;
      }
      .list .v1llrsih-1 {
        &.v10hx3vl-small .icon {
          color: blue;
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
      <div className={"v1560qbr-1 v1560qbr-2 vmabrr v1jk93k"}>
        <div className="v1560qbr-3" />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      &.vmabrr {
        color: red;
      }
    }

    .v1560qbr-2 {
      &.v1jk93k {
        font-size: 2em;
      }
      &.vmabrr {
        color: blue;
      }
    }

    .v1560qbr-3 {
      .v1560qbr-1.vmabrr & {
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
      <a className={"v1560qbr-1 v1560qbr-2 v1exp0sy"}>
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
      &.v1exp0sy {
        color: blue;
      }
    }

    .v1560qbr-3 {
      .v1560qbr-2.v1exp0sy & {
        color: green;
      }
    }
    "
  `);
});
