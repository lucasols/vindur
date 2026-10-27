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
