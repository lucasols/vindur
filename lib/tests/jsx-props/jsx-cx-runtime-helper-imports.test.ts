import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should keep namespace vindur imports separate from helper imports', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import * as vindur from 'vindur';
      import { css } from 'vindur';

      export const App = ({ on }) => (
        <div css={\`color: red;\`} cx={{ on }} title={vindur.version} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    import * as vindur from "vindur";
    export const App = ({ on }) => (
      <div
        className={
          "v1560qbr-1-css-prop-1 " +
          cx({
            "v1560qbr-2-on": on,
          })
        }
        title={vindur.version}
      />
    );
    "
  `);
});

test('should alias the cx helper when the file calls a global cx', async () => {
  const result = await transformWithFormat({
    source: dedent`
      const label = cx('x');

      export const App = ({ on }) => <div cx={{ $on: on }} title={label} />;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx as _vCx } from "vindur";
    const label = cx("x");
    export const App = ({ on }) => (
      <div
        title={label}
        className={_vCx({
          on: on,
        })}
      />
    );
    "
  `);
});
