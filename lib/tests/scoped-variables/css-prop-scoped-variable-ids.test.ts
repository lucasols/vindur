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
        <div dynamicColor={color.set(c)} css={\`color: \${color.value};\`} />
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

test('should reject scoped variables from interpolated values', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { withGap } from '#/fns'

        export const Box = () => <div css={\`\${withGap(2)}\`} />
      `,
      overrideDefaultFs: createFsMock({
        'fns.ts': dedent`
          import { vindurFn } from 'vindur'

          export const withGap = vindurFn((size: number) => \`---gap: \${size}px; gap: var(---gap);\`)
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Interpolated values can't contain scoped variables like "---gap", write scoped variables directly in the template
    loc: 3:38]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const GAP = '---gap'

        const Box = styled.div\`
          gap: var(\${GAP});
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Interpolated values can't contain scoped variables like "---gap", write scoped variables directly in the template
    loc: 6:13]
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

test('should reserve ids for css prop scoped variables with underscores', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur'

      export const App = () => (
        <div css={\`---a_b: 1px; ---a_c: 2px; width: calc(var(---a_b) + var(---a_c));\`} />
      )

      const color = createDynamicCssColor()

      export const Swatch = () => <div {...color.set('#fff')} />
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    export const App = () => <div className="v1560qbr-1" />;
    const color = createDynamicCssColor("v1560qbr-4", false);
    export const Swatch = () => <div {...color.set("#fff")} />;
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      --v1560qbr-2: 1px;
      --v1560qbr-3: 2px;
      width: calc(var(--v1560qbr-2) + var(--v1560qbr-3));
    }
    "
  `);
});

test('should not reuse the id of a later dynamic color for a styled scoped variable', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled, createDynamicCssColor } from 'vindur'

      export const Panel = ({ children }) => (
        <div css={\`---gap: 8px; padding: var(---gap);\`}>{children}</div>
      )

      export const Card = styled.div\`---radius: 4px; border-radius: var(---radius);\`

      export const accent = createDynamicCssColor()

      export const Title = styled.h1\`color: \${accent.var};\`

      export const App = () => (
        <Card dynamicColor={accent.set('#f00')}>
          <Panel>
            <Title>hi</Title>
          </Panel>
        </Card>
      )
    `,
    production: true,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, _vSC } from "vindur";
    export const Panel = ({ children }) => (
      <div className="v1560qbr-1">{children}</div>
    );
    export const Card = _vSC("div", "v1560qbr-3");
    export const accent = createDynamicCssColor("v1560qbr-5", false);
    export const Title = _vSC("h1", "v1560qbr-6");
    export const App = () => (
      <Card {...accent._sp("#f00")}>
        <Panel>
          <Title>hi</Title>
        </Panel>
      </Card>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-3 {
      --v1560qbr-4: 4px;
      border-radius: var(--v1560qbr-4);
    }

    .v1560qbr-6 {
      color: var(--v1560qbr-5);
    }

    .v1560qbr-1 {
      --v1560qbr-2: 8px;
      padding: var(--v1560qbr-2);
    }
    "
  `);
});
