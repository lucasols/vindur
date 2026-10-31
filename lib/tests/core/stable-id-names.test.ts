import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should replace $ in variable names of stable ids', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createClassName, css, stableId } from 'vindur'

      export const $active = createClassName()
      export const $id = stableId()

      export const style = css\`
        \${$active.selector} {
          color: red;
        }
      \`
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const $active = {
      selector: ".v1560qbr-1-_active",
      value: "v1560qbr-1-_active",
    };
    export const $id = "v1560qbr-2-_id";
    export const style = "v1560qbr-3-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-3-style {
      .v1560qbr-1-_active {
        color: red;
      }
    }
    "
  `);
});

test('should use short stable names in production', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createClassName, createCssVar, stableId } from 'vindur'

      export const active = createClassName()
      export const id = stableId()
      export const iconColor = createCssVar()
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const active = {
      selector: ".v1560qbr-1",
      value: "v1560qbr-1",
    };
    export const id = "v1560qbr-2";
    export const iconColor = {
      name: "--v1560qbr-3",
      var: "var(--v1560qbr-3)",
    };
    "
  `);
});
