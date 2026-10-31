import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should throw for namespace and default vindur imports', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import * as vindur from 'vindur';

        export const App = ({ on }) => <div cx={{ $on: on }} title={vindur.version} />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: namespace vindur imports are not supported, import the names you use, eg. import { styled } from "vindur"
    loc: 1:7]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import vindur from 'vindur';

        export const App = () => <div title={vindur.version} />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: default vindur imports are not supported, import the names you use, eg. import { styled } from "vindur"
    loc: 1:7]
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
    "const label = cx("x");
    export const App = ({ on }) => <div title={label} className={on ? "on" : ""} />;
    "
  `);
});
