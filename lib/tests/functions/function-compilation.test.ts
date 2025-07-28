import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('compile file with exported function', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { vindurFn } from 'vindur'

      export const spacing = vindurFn((size: number) => \`margin: \${size}px\`)
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { vindurFn } from "vindur";
    export const spacing = vindurFn((size: number) => \`margin: \${size}px\`);
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`""`);
});
