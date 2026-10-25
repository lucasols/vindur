import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

test('should give css prop scoped variables ids after the cx classes of the element', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur'

      export const Box = ({ on }) => (
        <div css={\`---gap: 1px; gap: var(---gap); &.on { gap: 2px; }\`} cx={{ on }} />
      )

      const color = createDynamicCssColor()

      export const Badge = ({ c }) => (
        <div dynamicColor={color.set(c)} css={\`color: \${color.var};\`} />
      )
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, cx } from "vindur";
    export const Box = ({ on }) => (
      <div
        className={
          "v1560qbr-1 " +
          cx({
            "v1560qbr-2": on,
          })
        }
      />
    );
    const color = createDynamicCssColor("v1560qbr-4", false);
    export const Badge = ({ c }) => (
      <div
        {...color._sp(c, {
          className: "v1560qbr-5",
        })}
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      --v1560qbr-3: 1px;
      gap: var(--v1560qbr-3);
      &.v1560qbr-2 {
        gap: 2px;
      }
    }

    .v1560qbr-5 {
      color: var(--v1560qbr-4);
    }
    "
  `);
});

test('should not reuse the ids of later declarations for scoped variables from interpolations', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur'
      import { withGap } from '#/fns'

      export const Box = () => <div css={\`\${withGap(2)}\`} />

      const color = createDynamicCssColor()

      export const Badge = ({ c }) => (
        <div dynamicColor={color.set(c)} css={\`color: \${color.var};\`} />
      )
    `,
    overrideDefaultFs: createFsMock({
      'fns.ts': dedent`
        import { vindurFn } from 'vindur'

        export const withGap = vindurFn((size: number) => \`---gap: \${size}px; gap: var(---gap);\`)
      `,
    }),
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    export const Box = () => <div className="v1560qbr-1" />;
    const color = createDynamicCssColor("v1560qbr-2", false);
    export const Badge = ({ c }) => (
      <div
        {...color._sp(c, {
          className: "v1560qbr-3",
        })}
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      --v1560qbr-4: 2px;
      gap: var(--v1560qbr-4);
    }

    .v1560qbr-3 {
      color: var(--v1560qbr-2);
    }
    "
  `);
});

test('should map a style prop variable declared by a child css prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const App = ({ width }) => (
        <div style={{ '---width': width }}>
          <span css={\`---width: 10px; width: var(---width);\`} />
        </div>
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = ({ width }) => (
      <div
        style={{
          "--v1560qbr-2-width": width,
        }}
      >
        <span className="v1560qbr-1-css-prop-1" />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-css-prop-1 {
      --v1560qbr-2-width: 10px;
      width: var(--v1560qbr-2-width);
    }
    "
  `);
});
