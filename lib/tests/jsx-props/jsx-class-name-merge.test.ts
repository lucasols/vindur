import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should skip an undefined className prop when merging with the cx prop on styled components', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        &.disabled {
          opacity: 0.5;
        }
      \`;

      export const A = ({ on, className }: { on: boolean; className?: string }) => (
        <Box className={className} cx={{ disabled: !on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const A = ({ on, className }: { on: boolean; className?: string }) => (
      <div
        className={
          (className || "") +
          " v1560qbr-1-Box " +
          cx({
            "v1560qbr-2-disabled": !on,
          })
        }
      />
    );
    "
  `);
});

test('should skip an undefined className prop when merging with the cx prop on native elements', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = ({ on, className }: { on: boolean; className?: string }) => (
        <div className={className} cx={{ $disabled: !on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const A = ({ on, className }: { on: boolean; className?: string }) => (
      <div
        className={
          (className || "") +
          " " +
          cx({
            disabled: !on,
          })
        }
      />
    );
    "
  `);
});

test('should keep the cx prop when merging the css prop with a className expression', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = ({ on, className }: { on: boolean; className?: string }) => (
        <div className={className} css={\`color: red;\`} cx={{ $disabled: !on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const A = ({ on, className }: { on: boolean; className?: string }) => (
      <div
        className={
          (className || "") +
          " v1560qbr-1-css-prop-1 " +
          cx({
            disabled: !on,
          })
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-css-prop-1 {
      color: red;
    }
    "
  `);
});

test('should keep the cx prop when merging the css prop with a className string', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = ({ on }: { on: boolean }) => (
        <div className="base" css={\`color: red;\`} cx={{ $disabled: !on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const A = ({ on }: { on: boolean }) => (
      <div
        className={
          "base v1560qbr-1-css-prop-1 " +
          cx({
            disabled: !on,
          })
        }
      />
    );
    "
  `);
});

test('should guard the whole className expression when merging with the cx prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = ({ on, c }: { on: boolean; c?: string }) => (
        <>
          <div className={on ? c : undefined} cx={{ $d: on }} />
          <div className={c ?? 'x'} cx={{ $d: on }} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const A = ({ on, c }: { on: boolean; c?: string }) => (
      <>
        <div
          className={
            ((on ? c : undefined) || "") +
            " " +
            cx({
              d: on,
            })
          }
        />
        <div
          className={
            ((c ?? "x") || "") +
            " " +
            cx({
              d: on,
            })
          }
        />
      </>
    );
    "
  `);
});

test('should concat a className expression with the css prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = ({ className }: { className?: string }) => (
        <div className={className} css={\`color: red;\`} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = ({ className }: { className?: string }) => (
      <div className={(className || "") + " v1560qbr-1-css-prop-1"} />
    );
    "
  `);
});

test('should keep the string value of a className literal when merging', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = ({ on }: { on: boolean }) => (
        <>
          <div className='a"b &amp; c
            d' css={\`color: red;\`} cx={{ $d: on }} />
          <div className='a"b' css={\`color: blue;\`} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const A = ({ on }: { on: boolean }) => (
      <>
        <div
          className={
            'a"b & c\\n      d v1560qbr-1-css-prop-1 ' +
            cx({
              d: on,
            })
          }
        />
        <div className='a"b v1560qbr-2-css-prop-2' />
      </>
    );
    "
  `);
});

test('should merge the cx prop and className with a css prop reference', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';

      const card = css\`
        &.active {
          color: red;
        }
      \`;

      export const A = ({ on, className }: { on: boolean; className?: string }) => (
        <div className={className} css={card} cx={{ active: on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    const card = "v1560qbr-1-card";
    export const A = ({ on, className }: { on: boolean; className?: string }) => (
      <div
        className={
          (className || "") +
          " v1560qbr-1-card " +
          cx({
            "v1560qbr-3-active": on,
          })
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-card {
      &.v1560qbr-3-active {
        color: red;
      }
    }
    "
  `);
});

test('should merge spread props with explicit className and import mergeClassNames', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = (props: { className?: string }) => (
        <>
          <div {...props} cx={{ $active: true }} />
          <div {...props} className="explicit" css={\`color: red;\`} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx, mergeClassNames } from "vindur";
    export const A = (props: { className?: string }) => (
      <>
        <div
          {...props}
          className={mergeClassNames(
            [props],
            cx({
              active: true,
            }),
          )}
        />
        <div
          {...props}
          className={mergeClassNames([props, "explicit"], "v1560qbr-1-css-prop-1")}
        />
      </>
    );
    "
  `);
});
