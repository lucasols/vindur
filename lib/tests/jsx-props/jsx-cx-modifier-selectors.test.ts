import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
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
