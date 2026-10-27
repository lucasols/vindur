import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/transform';
import { transformWithFormat } from '../testUtils';

test('should rename style prop variables read by css props', async () => {
  const warnings: TransformWarning[] = [];

  const result = await transformWithFormat({
    source: dedent`
      const App = ({ width }: { width: string }) => (
        <div style={{ '---width': width }} css={\`width: var(---width);\`}>
          <span css={\`height: var(---width);\`} />
        </div>
      )
    `,
    onWarning: (warning) => warnings.push(warning),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const App = ({ width }: { width: string }) => (
      <div
        style={{
          "--v1560qbr-2-width": width,
        }}
        className="v1560qbr-1-css-prop-1"
      >
        <span className="v1560qbr-3-css-prop-3" />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-css-prop-1 {
      width: var(--v1560qbr-2-width);
    }

    .v1560qbr-3-css-prop-3 {
      height: var(--v1560qbr-2-width);
    }
    "
  `);

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});

test('should rename style prop variables merged by dynamicColor', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur'

      const color = createDynamicCssColor()

      const App = ({ width }: { width: string }) => (
        <div
          dynamicColor={color.set('#fff')}
          style={{ '---width': width }}
          css={\`width: var(---width);\`}
        />
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    const App = ({ width }: { width: string }) => (
      <div
        {...color._sp("#fff", {
          className: "v1560qbr-2-css-prop-2",
          style: {
            "--v1560qbr-3-width": width,
          },
        })}
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2-css-prop-2 {
      width: var(--v1560qbr-3-width);
    }
    "
  `);
});

test('should throw for style prop scoped variables no style of the file uses', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Card = styled.div\`
          color: var(---color);
        \`

        export const App = () => <Card style={{ '---other': 'red' }} />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped variable \`---other\` is not used by any style of this file, scoped variables only exist in the file whose styles use them
    loc: 7:40]
  `);
});

test('should throw for scoped variable keys outside an inline style object', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        const Card = styled.div\`
          width: var(---w);
        \`
        export const App = ({ a }) => <Card style={a ? { '---w': '2px' } : undefined} />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped variables must be keys of an inline \`style={{ ... }}\` object to be renamed
    loc: 5:49]
  `);
});

test('should throw for scoped variable keys in attrs', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        const Card = styled.div.attrs({ style: { '---w': '2px' } })\`
          width: var(---w);
        \`
        export const App = () => <Card />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: styled.*.attrs() cannot set scoped variables, set them in the \`style\` prop where the component is rendered
    loc: 2:41]
  `);
});
