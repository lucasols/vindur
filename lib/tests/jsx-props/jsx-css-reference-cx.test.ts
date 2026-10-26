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
            "v1560qbr-2-styles " +
            cx({
              "v1560qbr-4-active": active,
            })
          }
        />
        <div
          {...color._sp(c, {
            className:
              "v1560qbr-2-styles " +
              cx({
                "v1560qbr-4-active": active,
                raw: true,
              }),
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

  await expect(transformWithFormat({ source: source('css={cls} cx={{ on }}') }))
    .rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop modifiers can't be used on styled component "Box" with the css reference "cls". Move the modifier styles into the styled component or use $-prefixed classes (e.g. $active).
    loc: 17:43]
  `);

  await expect(
    transformWithFormat({
      source: source('css={cls} cx={{ on }} dynamicColor={color.set(c)}'),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop modifiers can't be used on styled component "Box" with the css reference "cls". Move the modifier styles into the styled component or use $-prefixed classes (e.g. $active).
    loc: 17:43]
  `);

  await expect(
    transformWithFormat({ source: source('className={cls} cx={{ on }}') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop modifiers can't be used on styled component "Box" with the css reference "cls". Move the modifier styles into the styled component or use $-prefixed classes (e.g. $active).
    loc: 17:49]
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
        className={
          "v1560qbr-2-Box v1560qbr-1-cls " +
          cx({
            on: on,
            "v1560qbr-4-active": active,
          })
        }
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

test('should fail on a class used both hashed and with $ in cx props of the same styles', async () => {
  const source = (elements: string) => dedent`
    import { css, styled } from 'vindur'

    const styles = css\`
      &.active {
        color: blue;
      }
    \`

    const Box = styled.div\`
      &.active {
        color: yellow;
      }
    \`

    const Component = ({ on }) => (
      <>
        ${elements}
      </>
    );
  `;

  await expect(
    transformWithFormat({
      source: source(
        '<div css={styles} cx={{ active: on }} />\n<div css={styles} cx={{ $active: on }} />',
      ),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop class "active" is used both hashed and as "$active" with the same styles, hashing renames their "&.active" selectors so "$active" would stop matching. Use the same key in all cx props of these styles.
    loc: 18:28]
  `);

  await expect(
    transformWithFormat({
      source: source(
        '<Box cx={{ $active: on }} />\n<Box cx={{ active: on }} />',
      ),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop class "active" is used both hashed and as "$active" with the same styles, hashing renames their "&.active" selectors so "$active" would stop matching. Use the same key in all cx props of these styles.
    loc: 18:15]
  `);
});

test('should allow a class hashed and with $ in cx props of different styles', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, styled } from 'vindur'

      const styles = css\`
        &.active {
          color: blue;
        }
      \`

      const Box = styled.div\`
        &.active {
          color: yellow;
        }
      \`

      const Component = ({ on }) => (
        <>
          <div css={styles} cx={{ $active: on }} />
          <Box cx={{ active: on }} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    const styles = "v1560qbr-1-styles";
    const Component = ({ on }) => (
      <>
        <div
          className={
            "v1560qbr-1-styles " +
            cx({
              active: on,
            })
          }
        />
        <div
          className={
            "v1560qbr-2-Box " +
            cx({
              "v1560qbr-4-active": on,
            })
          }
        />
      </>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-styles {
      &.active {
        color: blue;
      }
    }

    .v1560qbr-2-Box {
      &.v1560qbr-4-active {
        color: yellow;
      }
    }
    "
  `);
});
