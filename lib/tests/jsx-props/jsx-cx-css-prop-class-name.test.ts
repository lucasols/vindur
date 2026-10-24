import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should merge css prop and cx prop with an existing className', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx } from 'vindur';

      function Component({ isActive, extra }) {
        return (
          <>
            <div
              className="base"
              cx={{ active: isActive }}
              css={\`
                color: red;
                &.active { color: blue; }
              \`}
            />
            <div
              className={extra}
              cx={{ active: isActive }}
              css={\`
                color: green;
                &.active { color: blue; }
              \`}
            />
          </>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component({ isActive, extra }) {
      return (
        <>
          <div
            className={
              "base v1560qbr-1-css-prop-1 " +
              cx({
                "v1560qbr-2-active": isActive,
              })
            }
          />
          <div
            className={[
              extra,
              "v1560qbr-3-css-prop-3 " +
                cx({
                  "v1560qbr-4-active": isActive,
                }),
            ]
              .filter(Boolean)
              .join(" ")}
          />
        </>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-css-prop-1 {
      color: red;
      &.v1560qbr-2-active {
        color: blue;
      }
    }

    .v1560qbr-3-css-prop-3 {
      color: green;
      &.v1560qbr-4-active {
        color: blue;
      }
    }
    "
  `);
});
