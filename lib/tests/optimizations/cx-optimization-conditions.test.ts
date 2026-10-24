import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should keep the grouping of optimized cx conditions', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx } from 'vindur';

      export const classes = (enabled, a, b, c) => [
        cx({ active: enabled ? true : false }),
        cx({ active: (a || b) && c }),
        cx('x', { active: enabled ? true : false, other: c }),
      ];
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const classes = (enabled, a, b, c) => [
      (enabled ? true : false) ? "active" : "",
      (a || b) && c ? "active" : "",
      "x" + (((enabled ? true : false) ? " active" : "") + (c ? " other" : "")),
    ];
    "
  `);
});

test('should keep cx calls with getters at runtime', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx } from 'vindur';

      export const classes = (enabled) => cx({ get active() { return enabled; } });
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const classes = (enabled) =>
      cx({
        get active() {
          return enabled;
        },
      });
    "
  `);
});

test('should not optimize calls of an aliased cx import', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx as cn } from 'vindur';

      export const classes = (name, enabled) => [
        cn({ [name]: true }),
        cn({ active: enabled }),
      ];
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx as cn } from "vindur";
    export const classes = (name, enabled) => [
      cn({
        [name]: true,
      }),
      cn({
        active: enabled,
      }),
    ];
    "
  `);
});
