import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
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
        <div
          className={
            "v1560qbr-1-Widget v1560qbr-1-Widget-_active v1560qbr-1-Widget-_size-small"
          }
        />
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Widget {
      background: white;

      &.v1560qbr-1-Widget-_active {
        background: blue;
      }

      &.v1560qbr-1-Widget-_size-small {
        padding: 4px;
      }

      &.v1560qbr-1-Widget-_size-large {
        padding: 16px;
      }
    }
    "
  `);
});

const componentPrefixedFlagsSource = dedent`
  import { styled } from 'vindur';

  const Button = styled.button<{
    active: boolean;
    size: 'small' | 'large';
  }>\`
    padding: 8px;

    &.active {
      color: red;
    }

    &.size-small {
      padding: 4px;
    }

    &.size-large {
      padding: 16px;
    }
  \`;

  const IconButton = styled(Button)\`
    gap: 4px;

    &.active {
      color: blue;
    }
  \`;

  const Label = styled.span\`
    \${Button}.active & {
      font-weight: bold;
    }
  \`;

  function Component({ active }: { active: boolean }) {
    return (
      <>
        <Button active={active} size="small">
          <Label>Button</Label>
        </Button>
        <IconButton active size="large" />
      </>
    );
  }
`;

test('should prefix dev modifier class names with the component class', async () => {
  const result = await transformWithFormat({
    source: componentPrefixedFlagsSource,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ active }: { active: boolean }) {
      return (
        <>
          <button
            className={
              "v1560qbr-1-Button v1560qbr-1-Button-size-small" +
              (active ? " v1560qbr-1-Button-active" : "")
            }
          >
            <span className="v1560qbr-3-Label">Button</span>
          </button>
          <button
            className={
              "v1560qbr-1-Button v1560qbr-2-IconButton v1560qbr-1-Button-active v1560qbr-1-Button-size-large"
            }
          />
        </>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      padding: 8px;

      &.v1560qbr-1-Button-active {
        color: red;
      }

      &.v1560qbr-1-Button-size-small {
        padding: 4px;
      }

      &.v1560qbr-1-Button-size-large {
        padding: 16px;
      }
    }

    .v1560qbr-2-IconButton {
      gap: 4px;

      &.v1560qbr-1-Button-active {
        color: blue;
      }
    }

    .v1560qbr-3-Label {
      .v1560qbr-1-Button.v1560qbr-1-Button-active & {
        font-weight: bold;
      }
    }
    "
  `);
});

test('should keep production modifier class names unchanged', async () => {
  const result = await transformWithFormat({
    source: componentPrefixedFlagsSource,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ active }: { active: boolean }) {
      return (
        <>
          <button
            className={"v1560qbr-1 v16ujyv9-small" + (active ? " vmabrr" : "")}
          >
            <span className="v1560qbr-3">Button</span>
          </button>
          <button className={"v1560qbr-1 v1560qbr-2 vmabrr v16ujyv9-large"} />
        </>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      padding: 8px;

      &.vmabrr {
        color: red;
      }

      &.v16ujyv9-small {
        padding: 4px;
      }

      &.v16ujyv9-large {
        padding: 16px;
      }
    }

    .v1560qbr-2 {
      gap: 4px;

      &.vmabrr {
        color: blue;
      }
    }

    .v1560qbr-3 {
      .v1560qbr-1.vmabrr & {
        font-weight: bold;
      }
    }
    "
  `);
});

const redeclaredFlagsSource = dedent`
  import { styled } from 'vindur';

  const Button = styled.button<{ active: boolean }>\`
    &.active {
      color: red;
    }
  \`;

  const IconButton = styled(Button)<{ active: boolean; big: boolean }>\`
    &.big {
      font-size: 20px;
    }
  \`;

  function Component({ active }: { active: boolean }) {
    return <IconButton active={active} big />;
  }
`;

test('should keep the base modifier classes for flags redeclared in dev', async () => {
  const warnings: TransformWarning[] = [];

  const result = await transformWithFormat({
    source: redeclaredFlagsSource,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ active }: { active: boolean }) {
      return (
        <button
          className={
            "v1560qbr-1-Button v1560qbr-2-IconButton v1560qbr-2-IconButton-big" +
            (active ? " v1560qbr-1-Button-active" : "")
          }
        />
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      &.v1560qbr-1-Button-active {
        color: red;
      }
    }

    .v1560qbr-2-IconButton {
      &.v1560qbr-2-IconButton-big {
        font-size: 20px;
      }
    }
    "
  `);

  expect(warnings).toMatchInlineSnapshot(`[]`);
});

test('should keep the base modifier classes for flags redeclared in production', async () => {
  const result = await transformWithFormat({
    source: redeclaredFlagsSource,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ active }: { active: boolean }) {
      return (
        <button
          className={"v1560qbr-1 v1560qbr-2 v1jk93k" + (active ? " vmabrr" : "")}
        />
      );
    }
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
        font-size: 20px;
      }
    }
    "
  `);
});

test('should keep the base flags when an extension adds its own flags', async () => {
  const warnings: TransformWarning[] = [];

  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Button = styled.button<{ active: boolean }>\`
        &.active {
          color: red;
        }
      \`;

      const BigButton = styled(Button)<{ big: boolean }>\`
        &.big {
          font-size: 20px;
        }
      \`;

      function Component({ active }: { active: boolean }) {
        return <BigButton active={active} big />;
      }
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ active }: { active: boolean }) {
      return (
        <button
          className={
            "v1560qbr-1-Button v1560qbr-2-BigButton v1560qbr-2-BigButton-big" +
            (active ? " v1560qbr-1-Button-active" : "")
          }
        />
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      &.v1560qbr-1-Button-active {
        color: red;
      }
    }

    .v1560qbr-2-BigButton {
      &.v1560qbr-2-BigButton-big {
        font-size: 20px;
      }
    }
    "
  `);

  expect(warnings).toMatchInlineSnapshot(`[]`);
});

test('should not match a referenced flag that prefixes another flag', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Menu = styled.div<{ open: boolean; openMenu: boolean }>\`
        &.open {
          color: red;
        }

        &.openMenu {
          color: blue;
        }
      \`;

      const Item = styled.div\`
        \${Menu}.openMenu & {
          font-weight: bold;
        }
      \`;

      function Component({ open }: { open: boolean }) {
        return (
          <Menu open={open} openMenu>
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
        <div className={"v1560qbr-1 v1r8z3y2" + (open ? " vc2c9p2" : "")}>
          <div className="v1560qbr-2" />
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

      &.v1r8z3y2 {
        color: blue;
      }
    }

    .v1560qbr-2 {
      .v1560qbr-1.v1r8z3y2 & {
        font-weight: bold;
      }
    }
    "
  `);
});
