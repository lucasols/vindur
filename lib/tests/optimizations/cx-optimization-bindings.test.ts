import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should import cx for cx props when the vindur cx is aliased', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx as classes } from 'vindur'

      export const A = ({ size }) => <div className={classes('x', size && 'big')} />

      export const B = ({ on }) => <div css={\`&.on { color: blue; }\`} cx={{ on }} />
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const A = ({ size }) => <div className={"x" + (size ? " big" : "")} />;
    export const B = ({ on }) => (
      <div
        className={
          "v1560qbr-1-css-prop-1 " +
          cx({
            "v1560qbr-2-on": on,
          })
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-css-prop-1 {
      &.v1560qbr-2-on {
        color: blue;
      }
    }
    "
  `);
});

test('should throw when another cx is imported in a file with cx props', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { cx } from 'classnames'

        const card = css\`color: red; &.on { color: blue; }\`

        export const A = ({ on }) => <div className={cx('x')} css={card} cx={{ on }} />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`cx\` is already declared in this file, but the code vindur generates calls the \`cx\` from vindur. Rename this binding
    loc: 2:9]
  `);
});

test('should only optimize calls of the cx imported from vindur', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx } from 'vindur'

      export const A = ({ active }) => {
        const cx = (...names) => names.join(' ')
        return <div className={cx('a', active && 'b')} />
      }

      export const B = ({ active }) => <div className={cx('a', active && 'b')} />
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = ({ active }) => {
      const cx = (...names) => names.join(" ");
      return <div className={cx("a", active && "b")} />;
    };
    export const B = ({ active }) => <div className={"a" + (active ? " b" : "")} />;
    "
  `);
});

test('should keep template literal classes as written', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx } from 'vindur'

      export const A = ({ active, size, fallback, id }) => (
        <div
          className={cx(
            'base',
            active && \`size-\${size ? 'big' : 'small'}\`,
            size && \`kind-\${fallback || 'default'}\`,
            id && \`item-\${getId({ id })}\`,
          )}
        />
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = ({ active, size, fallback, id }) => (
      <div
        className={
          "base" +
          (active ? \` size-\${size ? "big" : "small"}\` : "") +
          (size ? \` kind-\${fallback || "default"}\` : "") +
          (id
            ? \` item-\${getId({
                id,
              })}\`
            : "")
        }
      />
    );
    "
  `);
});
