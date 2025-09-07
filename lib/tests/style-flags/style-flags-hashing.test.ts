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
