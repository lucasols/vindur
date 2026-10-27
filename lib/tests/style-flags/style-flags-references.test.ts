import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

test('should use the referenced component classes for flags it shares with the referencing one', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Menu = styled.div<{ active: boolean }>\`
        &.active {
          color: red;
        }
      \`;

      const Item = styled.span<{ active: boolean }>\`
        &.active {
          color: blue;
        }

        \${Menu}.active & {
          color: green;
        }

        \${() => Panel}.active & {
          color: orange;
        }
      \`;

      const Panel = styled.div<{ active: boolean }>\`
        &.active {
          color: gray;
        }
      \`;

      function Component({ active }: { active: boolean }) {
        return (
          <Panel active={active}>
            <Menu active={active}>
              <Item active={active} />
            </Menu>
          </Panel>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ active }: { active: boolean }) {
      return (
        <div
          className={
            "v1560qbr-3-Panel" + (active ? " v1560qbr-3-Panel-active" : "")
          }
        >
          <div
            className={
              "v1560qbr-1-Menu" + (active ? " v1560qbr-1-Menu-active" : "")
            }
          >
            <span
              className={
                "v1560qbr-2-Item" + (active ? " v1560qbr-2-Item-active" : "")
              }
            />
          </div>
        </div>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Menu {
      &.v1560qbr-1-Menu-active {
        color: red;
      }
    }

    .v1560qbr-2-Item {
      &.v1560qbr-2-Item-active {
        color: blue;
      }

      .v1560qbr-1-Menu.v1560qbr-1-Menu-active & {
        color: green;
      }

      .v1560qbr-3-Panel.v1560qbr-3-Panel-active & {
        color: orange;
      }
    }

    .v1560qbr-3-Panel {
      &.v1560qbr-3-Panel-active {
        color: gray;
      }
    }
    "
  `);
});

test('should resolve every flag chained to a component reference', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Menu = styled.div<{ open: boolean; size: 'small' | 'large' }>\`
        &.open {
          color: red;
        }

        &.size-small {
          padding: 4px;
        }
      \`;

      const Item = styled.span\`
        \${Menu}.open.size-small & {
          font-weight: bold;
        }
      \`;

      function Component({ open }: { open: boolean }) {
        return (
          <Menu open={open} size="small">
            <Item />
          </Menu>
        );
      }
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ open }: { open: boolean }) {
      return (
        <div className={"v1560qbr-1 vr4ikfs-small" + (open ? " vodzbs9" : "")}>
          <span className="v1560qbr-2" />
        </div>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      &.vodzbs9 {
        color: red;
      }

      &.vr4ikfs-small {
        padding: 4px;
      }
    }

    .v1560qbr-2 {
      .v1560qbr-1.vodzbs9.vr4ikfs-small & {
        font-weight: bold;
      }
    }
    "
  `);
});

test('should warn about values a redeclared flag adds to the base flag', async () => {
  const warnings: TransformWarning[] = [];

  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Button = styled.button<{ size: 'small' | 'large' }>\`
        &.size-small {
          padding: 4px;
        }

        &.size-large {
          padding: 8px;
        }
      \`;

      const WideButton = styled(Button)<{ size: 'small' | 'wide' }>\`
        width: 100%;
      \`;

      function Component() {
        return <WideButton size="wide" />;
      }
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component() {
      return (
        <button
          className={
            "v1560qbr-1-Button v1560qbr-2-WideButton v1560qbr-1-Button-size-wide"
          }
        />
      );
    }
    "
  `);

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: 'Warning: Missing modifier styles for "&.size-wide" in WideButton'
        loc: 'current_file:13:6'
    "
  `);
});

test('should not rewrite classes that start with a flag name', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Button = styled.button<{ active: boolean }>\`
        &.active {
          color: red;
        }

        &.active-icon {
          color: blue;
        }
      \`;

      function Component({ active }: { active: boolean }) {
        return <Button active={active} />;
      }
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ active }: { active: boolean }) {
      return <button className={"v1560qbr-1" + (active ? " voctcyj" : "")} />;
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      &.voctcyj {
        color: red;
      }

      &.active-icon {
        color: blue;
      }
    }
    "
  `);
});
