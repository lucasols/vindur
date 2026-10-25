import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should keep the cx prop of an element with a css reference prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, createDynamicCssColor } from 'vindur'

      const color = createDynamicCssColor()

      const styles = css\`
        color: red;

        &.active {
          color: blue;
        }
      \`

      const Component = ({ active, c }) => (
        <>
          <div css={styles} cx={{ active }} />
          <div css={styles} cx={{ active, $raw: true }} dynamicColor={color.set(c)} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, cx } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    const styles = "v1560qbr-2-styles";
    const Component = ({ active, c }) => (
      <>
        <div
          className={
            styles +
            " " +
            cx({
              "v1560qbr-4-active": active,
            })
          }
        />
        <div
          {...color._sp(c, {
            className: [
              styles,
              cx({
                "v1560qbr-4-active": active,
                raw: true,
              }),
            ]
              .filter(Boolean)
              .join(" "),
          })}
        />
      </>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2-styles {
      color: red;

      &.v1560qbr-4-active {
        color: blue;
      }
    }
    "
  `);
});
