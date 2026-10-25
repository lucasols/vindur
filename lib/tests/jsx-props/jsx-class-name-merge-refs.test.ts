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

test('should allow cx modifiers declared outside the css references', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, styled } from 'vindur';
      import { base } from '#/styles';

      const layout = css\`
        display: flex;
      \`;

      const Box = styled.div\`
        &.active {
          color: red;
        }
      \`;

      export const A = ({ on }: { on: boolean }) => (
        <>
          <Box className={layout} cx={{ active: on }} />
          <div className={base} css={\`&.active { color: blue; }\`} cx={{ active: on }} />
        </>
      );
    `,
    overrideDefaultFs: createFsMock({
      'styles.ts': dedent`
        import { css } from 'vindur';

        export const base = css\`
          padding: 1px;
        \`;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    const layout = "v1560qbr-1-layout";
    export const A = ({ on }: { on: boolean }) => (
      <>
        <div
          className={
            layout +
            " v1560qbr-2-Box " +
            cx({
              "v1560qbr-3-active": on,
            })
          }
        />
        <div
          className={
            base +
            " v1560qbr-4-css-prop-4 " +
            cx({
              "v1560qbr-5-active": on,
            })
          }
        />
      </>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-layout {
      display: flex;
    }

    .v1560qbr-2-Box {
      &.v1560qbr-3-active {
        color: red;
      }
    }

    .v1560qbr-4-css-prop-4 {
      &.v1560qbr-5-active {
        color: blue;
      }
    }
    "
  `);
});

test('should handle an empty cx prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = () => <div cx={{}} />;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const A = () => <div className={cx({})} />;
    "
  `);
});

test('should keep explicit className on style flag components with spreads', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Btn = styled.button<{ active: boolean }>\`
        &.active {
          color: red;
        }
      \`;

      export const A = (props: { className?: string }) => (
        <Btn {...props} className="explicit" active />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx, mergeClassNames } from "vindur";
    export const A = (props: { className?: string }) => (
      <button
        {...props}
        className={cx(
          mergeClassNames([props, "explicit"], "v1560qbr-1-Btn"),
          "voctcyj-active",
        )}
      />
    );
    "
  `);
});

test('should not pass undefined as the vindur class name when merging dynamic colors with spreads', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur';

      const color = createDynamicCssColor();

      export const A = (props: { className?: string }) => (
        <div {...props} dynamicColor={color.set('#f00')} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, mergeClassNames, mergeStyles } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1", true);
    export const A = (props: { className?: string }) => (
      <div
        {...props}
        {...color._sp("#f00", {
          className: mergeClassNames([props], ""),
          style: mergeStyles([props]),
        })}
      />
    );
    "
  `);
});

test('should hash every cx modifier of a compound selector', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        &.active.disabled {
          color: red;
        }
        &::after {
          content: "&.active";
        }
      \`;

      export const A = ({ on }: { on: boolean }) => (
        <Box cx={{ active: on, disabled: !on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const A = ({ on }: { on: boolean }) => (
      <div
        className={
          "v1560qbr-1-Box " +
          cx({
            "v1560qbr-2-active": on,
            "v1560qbr-3-disabled": !on,
          })
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      &.v1560qbr-2-active.v1560qbr-3-disabled {
        color: red;
      }
      &::after {
        content: "&.active";
      }
    }
    "
  `);
});

test('should ignore modifier selectors inside css strings of css references', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, styled } from 'vindur';

      const label = css\`
        &::after {
          content: "&.active";
        }
      \`;

      const Box = styled.div\`
        &.active {
          color: red;
        }
      \`;

      export const A = ({ on }: { on: boolean }) => (
        <Box className={label} cx={{ active: on }} />
      );
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-label {
      &::after {
        content: "&.active";
      }
    }

    .v1560qbr-2-Box {
      &.v1560qbr-3-active {
        color: red;
      }
    }
    "
  `);
});
