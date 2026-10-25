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

test('should fail on hashed cx keys declared in the css reference of a styled component', async () => {
  const source = (attributes: string) => dedent`
    import { css, styled, createDynamicCssColor } from 'vindur'

    const color = createDynamicCssColor()

    const cls = css\`
      color: red;

      &.on {
        color: blue;
      }
    \`

    const Box = styled.div\`
      color: green;
    \`

    const Component = ({ on, c }) => <Box ${attributes} />;
  `;

  await expect(
    transformWithFormat({ source: source('css={cls} cx={{ on }}') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx modifiers [on] are declared in the css reference passed to Box, but cx only hashes the modifiers of the styled component. Use $ prefixed keys (e.g. $on) or move the modifiers into the styled component.
    loc: 17:48]
  `);

  await expect(
    transformWithFormat({
      source: source('css={cls} cx={{ on }} dynamicColor={color.set(c)}'),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx modifiers [on] are declared in the css reference passed to Box, but cx only hashes the modifiers of the styled component. Use $ prefixed keys (e.g. $on) or move the modifiers into the styled component.
    loc: 17:48]
  `);

  await expect(
    transformWithFormat({ source: source('className={cls} cx={{ on }}') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx modifiers [on] are declared in the css reference passed to Box, but cx only hashes the modifiers of the styled component. Use $ prefixed keys (e.g. $on) or move the modifiers into the styled component.
    loc: 17:54]
  `);
});

test('should keep $ cx keys and styled modifiers with a css reference on a styled component', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, styled } from 'vindur'

      const cls = css\`
        color: red;

        &.on {
          color: blue;
        }
      \`

      const Box = styled.div\`
        color: green;

        &.active {
          color: yellow;
        }
      \`

      const Component = ({ on, active }) => (
        <Box css={cls} cx={{ $on: on, active }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    const cls = "v1560qbr-1-cls";
    const Component = ({ on, active }) => (
      <div
        className={[
          "v1560qbr-2-Box",
          cls,
          cx({
            on: on,
            "v1560qbr-4-active": active,
          }),
        ]
          .filter(Boolean)
          .join(" ")}
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-cls {
      color: red;

      &.on {
        color: blue;
      }
    }

    .v1560qbr-2-Box {
      color: green;

      &.v1560qbr-4-active {
        color: yellow;
      }
    }
    "
  `);
});
