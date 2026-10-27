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
        <div className={"v1560qbr-1 v16ujyv9-small" + (open ? " vc2c9p2" : "")}>
          <span className="v1560qbr-2" />
        </div>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      &.vc2c9p2 {
        color: red;
      }

      &.v16ujyv9-small {
        padding: 4px;
      }
    }

    .v1560qbr-2 {
      .v1560qbr-1.vc2c9p2.v16ujyv9-small & {
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

test('should reject redeclaring a base flag with another type', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Button = styled.button<{ active: boolean }>\`
          &.active {
            color: red;
          }
        \`;

        const ToggleButton = styled(Button)<{ active: 'on' | 'off' }>\`
          color: blue;
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "active" is a boolean in the extended component, redeclare it with the same type
    loc: 9:38]
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
      return <button className={"v1560qbr-1" + (active ? " vmabrr" : "")} />;
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      &.vmabrr {
        color: red;
      }

      &.active-icon {
        color: blue;
      }
    }
    "
  `);
});

test('should resolve flags chained to a component reference through pseudo-classes', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Menu = styled.div<{ active: boolean; $open: boolean }>\`
        &.active {
          color: red;
        }

        &.$open {
          color: pink;
        }
      \`;

      const Item = styled.span<{ active: boolean; $open: boolean }>\`
        &.active {
          color: blue;
        }

        &.$open {
          color: gray;
        }

        \${Menu}:not(.active) & {
          opacity: 0.5;
        }

        \${Menu}:hover.active & {
          color: green;
        }

        \${Menu}.$open & {
          display: block;
        }
      \`;

      function Component({ active }: { active: boolean }) {
        return (
          <Menu active={active} $open>
            <Item active={active} $open />
          </Menu>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ active }: { active: boolean }) {
      return (
        <div
          className={
            "v1560qbr-1-Menu v1560qbr-1-Menu-_open" +
            (active ? " v1560qbr-1-Menu-active" : "")
          }
        >
          <span
            className={
              "v1560qbr-2-Item v1560qbr-2-Item-_open" +
              (active ? " v1560qbr-2-Item-active" : "")
            }
          />
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

      &.v1560qbr-1-Menu-_open {
        color: pink;
      }
    }

    .v1560qbr-2-Item {
      &.v1560qbr-2-Item-active {
        color: blue;
      }

      &.v1560qbr-2-Item-_open {
        color: gray;
      }

      .v1560qbr-1-Menu:not(.v1560qbr-1-Menu-active) & {
        opacity: 0.5;
      }

      .v1560qbr-1-Menu:hover.v1560qbr-1-Menu-active & {
        color: green;
      }

      .v1560qbr-1-Menu.v1560qbr-1-Menu-_open & {
        display: block;
      }
    }
    "
  `);
});

test('should reject transient flags chained to a forward component reference', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Item = styled.span<{ $open: boolean }>\`
          &.$open {
            color: gray;
          }

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
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
    [TransformError: /test.tsx: The transient style flag selector ".$open" can't follow a forward component reference, define the referenced component before this one
    loc: 3:13]
  `,
  );
});

test('should warn about flags only styled through another component reference', async () => {
  const warnings: TransformWarning[] = [];

  await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Menu = styled.div<{ active: boolean }>\`
        &.active {
          color: red;
        }
      \`;

      const Item = styled.span<{ active: boolean }>\`
        \${Menu}.active & {
          color: green;
        }
      \`;

      function Component({ active }: { active: boolean }) {
        return (
          <Menu active={active}>
            <Item active={active} />
          </Menu>
        );
      }
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: 'Warning: Missing modifier styles for "&.active" in Item'
        loc: 'current_file:9:6'
    "
  `);
});

test('should support flag names with non-ASCII characters', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Button = styled.button<{ café: boolean }>\`
        &.café {
          color: brown;
        }
      \`;

      function Component({ café }: { café: boolean }) {
        return <Button café={café} />;
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ café }: { café: boolean }) {
      return (
        <button
          className={"v1560qbr-1-Button" + (café ? " v1560qbr-1-Button-café" : "")}
        />
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      &.v1560qbr-1-Button-café {
        color: brown;
      }
    }
    "
  `);
});

test('should not rewrite flag names inside strings and urls', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Button = styled.button<{ active: boolean }>\`
        &.active {
          background: url(icon.active.svg);
        }

        &.active::after {
          content: ".active";
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
      return <button className={"v1560qbr-1" + (active ? " vmabrr" : "")} />;
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      &.vmabrr {
        background: url(icon.active.svg);
      }

      &.vmabrr::after {
        content: ".active";
      }
    }
    "
  `);
});
