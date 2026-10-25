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

test('should keep optimized cx calls grouped as operands', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx } from 'vindur';

      export const classes = (a, b) => [
        cx({ active: a }) + ' x',
        cx({ active: a }).length,
        !cx({ active: a }),
        cx('a', b && 'c').trim(),
      ];
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const classes = (a, b) => [
      (a ? "active" : "") + " x",
      (a ? "active" : "").length,
      !(a ? "active" : ""),
      ("a" + (b ? " c" : "")).trim(),
    ];
    "
  `);
});

test('should keep template literal expressions grouped in optimized cx calls', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx } from 'vindur';

      export const classes = (active, mode, a, b) => [
        cx(active && \`size-\${mode ? 'lg' : 'sm'}\`),
        cx(active && \`\${a}\${b}\`),
        cx(active && \`\${a}\`),
      ];
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const classes = (active, mode, a, b) => [
      active ? "size-" + (mode ? "lg" : "sm") : "",
      active ? "" + a + b : "",
      active ? "" + a : "",
    ];
    "
  `);
});

test('should escape line breaks in optimized cx strings', async () => {
  const result = await transformWithFormat({
    source: [
      "import { cx } from 'vindur';",
      '',
      'export const classes = (active) => cx("a\\nb", active && "c\\nd");',
    ].join('\n'),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const classes = (active) => "a\\nb" + (active ? " c\\nd" : "");
    "
  `);
});

test('should not optimize cx calls holding code other passes transform', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, cx } from 'vindur';

      export const App = ({ a }) => (
        <div className={cx({ [css\`color: red;\`]: a })} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const App = ({ a }) => (
      <div
        className={cx({
          ["v1560qbr-1"]: a,
        })}
      />
    );
    "
  `);
});
