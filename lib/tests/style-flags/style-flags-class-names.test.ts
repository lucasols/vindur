import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

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

test('should scope production modifier class names to the component', async () => {
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

test('should give each component its own modifier classes for the same flag', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Button = styled.button<{ active: boolean }>\`
        &.active {
          color: red;
        }
      \`;

      const Link = styled.a<{ active: boolean }>\`
        &.active {
          color: blue;
        }
      \`;

      export const App = () => (
        <>
          <Button active />
          <Link active />
        </>
      );
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = () => (
      <>
        <button className={"v1560qbr-1 vmabrr"} />
        <a className={"v1560qbr-2 v1exp0sy"} />
      </>
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
      &.v1exp0sy {
        color: blue;
      }
    }
    "
  `);
});

test('should keep the base modifier classes for flags redeclared by an extension', async () => {
  const warnings: TransformWarning[] = [];
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Button = styled.button<{ active: boolean; size: 'small' | 'large' }>\`
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

      const IconButton = styled(Button)<{
        active: boolean;
        size: 'small' | 'large' | 'huge';
        big: boolean;
      }>\`
        &.big {
          font-size: 20px;
        }
      \`;

      export const App = () => <IconButton active size="huge" big />;
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = () => (
      <button
        className={
          "v1560qbr-1-Button v1560qbr-2-IconButton v1560qbr-1-Button-active v1560qbr-1-Button-size-huge v1560qbr-2-IconButton-big"
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
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
      &.v1560qbr-2-IconButton-big {
        font-size: 20px;
      }
    }
    "
  `);

  expect(warnings.map((warning) => warning.message)).toMatchInlineSnapshot(`
    [
      "Warning: Missing modifier styles for "&.size-huge" in IconButton",
    ]
  `);
});
