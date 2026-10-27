import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should rewrite flags after comments with quotes', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Menu = styled.div<{ open: boolean }>\`
        /* don't style the closed menu */
        &.open {
          color: red;
        }
      \`;

      const Button = styled.button<{ primary: boolean; size: 'sm' | 'lg' }>\`
        color: blue; /* it's the default color */

        &.primary {
          color: white;
        }

        &.size-sm {
          padding: 4px;
        }

        \${Menu}.open & {
          color: green;
        }
      \`;

      function Component({ primary, open }: { primary: boolean; open: boolean }) {
        return (
          <Menu open={open}>
            <Button primary={primary} size="sm" />
          </Menu>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ primary, open }: { primary: boolean; open: boolean }) {
      return (
        <div className={"v1560qbr-1-Menu" + (open ? " v1560qbr-1-Menu-open" : "")}>
          <button
            className={
              "v1560qbr-2-Button v1560qbr-2-Button-size-sm" +
              (primary ? " v1560qbr-2-Button-primary" : "")
            }
          />
        </div>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Menu {
      /* don't style the closed menu */
      &.v1560qbr-1-Menu-open {
        color: red;
      }
    }

    .v1560qbr-2-Button {
      color: blue; /* it's the default color */

      &.v1560qbr-2-Button-primary {
        color: white;
      }

      &.v1560qbr-2-Button-size-sm {
        padding: 4px;
      }

      .v1560qbr-1-Menu.v1560qbr-1-Menu-open & {
        color: green;
      }
    }
    "
  `);
});

test('should select transient flags the referencing component does not declare', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Menu = styled.div<{ $open: boolean }>\`
        &.$open {
          color: pink;
        }
      \`;

      const Item = styled.span\`
        color: gray;

        \${Menu}.$open & {
          display: block;
        }
      \`;

      function Component() {
        return (
          <Menu $open>
            <Item />
          </Menu>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component() {
      return (
        <div className={"v1560qbr-1-Menu v1560qbr-1-Menu-_open"}>
          <span className="v1560qbr-2-Item" />
        </div>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Menu {
      &.v1560qbr-1-Menu-_open {
        color: pink;
      }
    }

    .v1560qbr-2-Item {
      color: gray;

      .v1560qbr-1-Menu.v1560qbr-1-Menu-_open & {
        display: block;
      }
    }
    "
  `);
});

test('should reject transient flags the referenced component does not declare', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Menu = styled.div\`
          color: pink;
        \`;

        const Item = styled.span\`
          \${Menu}.$open & {
            display: block;
          }
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: The transient style flag selector ".$open" is not a style flag of the referenced component
    loc: 7:13]
  `);
});

test('should reject transient flags of a forward reference the referencing component does not declare', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Item = styled.span\`
          \${() => Menu}.$open & {
            display: block;
          }
        \`;

        const Menu = styled.div<{ $open: boolean }>\`
          &.$open {
            color: pink;
          }
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: The transient style flag selector ".$open" can't follow a forward component reference, define the referenced component before this one
    loc: 3:13]
  `);
});

test('should resolve flags chained to a component reference nested in a pseudo-class', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Panel = styled.div<{ active: boolean }>\`
        &.active {
          color: red;
        }
      \`;

      const Menu = styled.div\`
        color: blue;
      \`;

      const Item = styled.span<{ active: boolean }>\`
        &.active {
          color: gray;
        }

        \${Menu}:has(\${Panel}.active) & {
          color: green;
        }
      \`;

      function Component({ active }: { active: boolean }) {
        return (
          <Menu>
            <Panel active={active} />
            <Item active={active} />
          </Menu>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ active }: { active: boolean }) {
      return (
        <div className="v1560qbr-2-Menu">
          <div
            className={
              "v1560qbr-1-Panel" + (active ? " v1560qbr-1-Panel-active" : "")
            }
          />
          <span
            className={
              "v1560qbr-3-Item" + (active ? " v1560qbr-3-Item-active" : "")
            }
          />
        </div>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Panel {
      &.v1560qbr-1-Panel-active {
        color: red;
      }
    }

    .v1560qbr-2-Menu {
      color: blue;
    }

    .v1560qbr-3-Item {
      &.v1560qbr-3-Item-active {
        color: gray;
      }

      .v1560qbr-2-Menu:has(.v1560qbr-1-Panel.v1560qbr-1-Panel-active) & {
        color: green;
      }
    }
    "
  `);
});
