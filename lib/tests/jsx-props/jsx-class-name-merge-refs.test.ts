import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { createFsMock, transformWithFormat } from '../testUtils';

test('should share cx modifier classes between different combinations of css references', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';

      const a = css\`
        &.active {
          color: red;
        }
      \`;

      const b = css\`
        &.active {
          color: blue;
        }
      \`;

      export const A = ({ on }: { on: boolean }) => (
        <>
          <div className={a} cx={{ active: on }} />
          <div className={b} cx={{ active: on }} />
          <div className={a} css={b} cx={{ active: on }} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    const a = "v1560qbr-1-a";
    const b = "v1560qbr-2-b";
    export const A = ({ on }: { on: boolean }) => (
      <>
        <div
          className={
            a +
            " " +
            cx({
              "v1560qbr-3-active": on,
            })
          }
        />
        <div
          className={
            b +
            " " +
            cx({
              "v1560qbr-3-active": on,
            })
          }
        />
        <div
          className={
            a +
            " v1560qbr-2-b " +
            cx({
              "v1560qbr-3-active": on,
            })
          }
        />
      </>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-a {
      &.v1560qbr-3-active {
        color: red;
      }
    }

    .v1560qbr-2-b {
      &.v1560qbr-3-active {
        color: blue;
      }
    }
    "
  `);
});

test('should not warn about cx modifiers declared only in a layer of a styled component', async () => {
  const warnings: TransformWarning[] = [];

  const result = await transformWithFormat({
    source: dedent`
      import { styled, layer } from 'vindur';

      const Box = styled.div\`
        color: blue;

        \${layer('base')} {
          &.on {
            color: red;
          }
        }
      \`;

      export const A = ({ on }: { on: boolean }) => <Box cx={{ on }} />;
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    []
    "
  `);

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const A = ({ on }: { on: boolean }) => (
      <div
        className={
          "v1560qbr-1-Box " +
          cx({
            "v1560qbr-2-on": on,
          })
        }
      />
    );
    "
  `);
});

test('should guard explicit className values when merging styled components with spreads', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        color: blue;
      \`;

      export const A = ({ p, q, on }: { p: object; q: object; on: boolean }) => (
        <Box {...p} className={on ? 'x' : undefined} {...q} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { mergeClassNames } from "vindur";
    export const A = ({ p, q, on }: { p: object; q: object; on: boolean }) => (
      <div
        {...p}
        {...q}
        className={mergeClassNames(
          [p, (on ? "x" : undefined) || "", q],
          "v1560qbr-1-Box",
        )}
      />
    );
    "
  `);
});

test('should throw when cx modifiers are used on a styled component with a css reference', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur';

        const Box = styled.div\`
          color: blue;
        \`;

        const card = css\`
          &.active {
            color: red;
          }
        \`;

        export const A = ({ on }: { on: boolean }) => (
          <Box css={card} cx={{ active: on }} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop modifiers can't be used on styled component "Box" with the css reference "card". Move the modifier styles into the styled component or use $-prefixed classes (e.g. $active).
    loc: 14:12]
  `);
});

test('should throw when cx modifiers are used with an imported css reference', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { card } from '#/styles';

        export const A = ({ on }: { on: boolean }) => (
          <div className={card} cx={{ active: on, $raw: on }} />
        );
      `,
      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          import { css } from 'vindur';

          export const card = css\`
            &.active {
              color: red;
            }
          \`;
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop modifiers can't be used with the imported css reference "card", its styles are defined in another file. Use $-prefixed classes (e.g. $active) or define the modifier styles locally.
    loc: 4:18]
  `);
});

test('should allow $-prefixed cx classes with an imported css reference', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { card } from '#/styles';

      export const A = ({ on }: { on: boolean }) => (
        <div css={card} cx={{ $active: on }} />
      );
    `,
    overrideDefaultFs: createFsMock({
      'styles.ts': dedent`
        import { css } from 'vindur';

        export const card = css\`
          &.active {
            color: red;
          }
        \`;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const A = ({ on }: { on: boolean }) => (
      <div
        className={
          "v1s4vg6s-1-card " +
          cx({
            active: on,
          })
        }
      />
    );
    "
  `);
});

test('should throw for non-identifier spreads merged with css or cx props', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        export const A = ({ getProps }: { getProps: () => object }) => (
          <div {...getProps()} css={\`color: red;\`} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Unsupported spread expression "getProps()" used in an element with vindur css or cx props. Only references to variables are allowed in spread expressions. Extract them to a variable and use that variable in the spread expression.
    loc: 2:7]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        export const A = ({ on, props }: { on: boolean; props: object }) => (
          <div {...(on && props)} cx={{ $active: on }} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Unsupported spread expression "on && props" used in an element with vindur css or cx props. Only references to variables are allowed in spread expressions. Extract them to a variable and use that variable in the spread expression.
    loc: 2:7]
  `);
});
