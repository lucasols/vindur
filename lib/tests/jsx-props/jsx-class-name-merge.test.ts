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
