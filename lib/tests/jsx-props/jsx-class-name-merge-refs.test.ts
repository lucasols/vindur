import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

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
