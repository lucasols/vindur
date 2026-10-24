import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

test('should only rewrite whole cx modifier class names in css', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled, cx } from 'vindur';

      const Box = styled.div\`
        &.active { color: red; }
        &.activeIcon { color: blue; }
      \`;

      function Component({ isActive, hasIcon }) {
        return (
          <>
            <Box cx={{ active: isActive, activeIcon: hasIcon }} />
            <div
              cx={{ active: isActive, activeIcon: hasIcon }}
              css={\`
                &.active { color: red; }
                &.activeIcon { color: blue; }
              \`}
            />
          </>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component({ isActive, hasIcon }) {
      return (
        <>
          <div
            className={
              "v1560qbr-1-Box " +
              cx({
                "v1560qbr-2-active": isActive,
                "v1560qbr-3-activeIcon": hasIcon,
              })
            }
          />
          <div
            className={
              "v1560qbr-4-css-prop-4 " +
              cx({
                "v1560qbr-5-active": isActive,
                "v1560qbr-6-activeIcon": hasIcon,
              })
            }
          />
        </>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      &.v1560qbr-2-active {
        color: red;
      }
      &.v1560qbr-3-activeIcon {
        color: blue;
      }
    }

    .v1560qbr-4-css-prop-4 {
      &.v1560qbr-5-active {
        color: red;
      }
      &.v1560qbr-6-activeIcon {
        color: blue;
      }
    }
    "
  `);
});

test('should warn about cx modifiers only declared as a prefix of another class', async () => {
  const warnings: TransformWarning[] = [];

  await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        &.activeIcon { color: blue; }
      \`;

      function Component({ isActive }) {
        return <Box cx={{ active: isActive }} />;
      }
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#: { message: 'Warning: Missing CSS classes for cx modifiers in Box: active', loc: 'current_file:8:9' }
    "
  `);
});

test('should rewrite every cx modifier class of compound selectors', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        &.active.selected { color: red; }
        &.selected:hover.active { color: blue; }
      \`;

      function Component({ isActive, isSelected }) {
        return <Box cx={{ active: isActive, selected: isSelected }} />;
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component({ isActive, isSelected }) {
      return (
        <div
          className={
            "v1560qbr-1-Box " +
            cx({
              "v1560qbr-2-active": isActive,
              "v1560qbr-3-selected": isSelected,
            })
          }
        />
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      &.v1560qbr-2-active.v1560qbr-3-selected {
        color: red;
      }
      &.v1560qbr-3-selected:hover.v1560qbr-2-active {
        color: blue;
      }
    }
    "
  `);
});
