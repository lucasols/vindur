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

test('should throw for scoped variables read in style prop values', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Card = styled.div\`padding: var(---size);\`

        export const App = () => (
          <Card style={{ '---size': '8px', margin: 'var(---size)' }} />
        )
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped variables can't be read in \`style\` prop values, they are not renamed there, read them in the styles of the element
    loc: 6:43]
  `);
});

test('should throw for scoped variables starting with a digit read in style prop values', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Card = styled.div\`padding: var(---2xl);\`

        export const App = () => (
          <Card style={{ '---2xl': '8px', margin: 'var(---2xl)' }} />
        )
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped variables can't be read in \`style\` prop values, they are not renamed there, read them in the styles of the element
    loc: 6:42]
  `);
});

test('should throw for computed scoped variable keys in the style prop', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Card = styled.div\`padding: var(---size);\`

        export const App = ({ name }) => (
          <Card style={{ '---size': '8px', [\`---\${name}\`]: 1 }} />
        )
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped variable keys of the \`style\` prop must be written out, like \`'---size'\`, computed keys are not renamed
    loc: 6:36]
  `);
});

test('should rename scoped variables of a style object with a type cast', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import type { CSSProperties } from 'react';

      export const App = ({ w }: { w: number }) => (
        <>
          <div css={\`width: var(---w);\`} style={{ '---w': w } as CSSProperties} />
          <div css={\`height: var(---w);\`} style={{ '---w': w } satisfies CSSProperties} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import type { CSSProperties } from "react";
    export const App = ({ w }: { w: number }) => (
      <>
        <div
          className="v1560qbr-1-css-prop-1"
          style={
            {
              "--v1560qbr-2-w": w,
            } as CSSProperties
          }
        />
        <div
          className="v1560qbr-3-css-prop-3"
          style={
            {
              "--v1560qbr-2-w": w,
            } satisfies CSSProperties
          }
        />
      </>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-css-prop-1 {
      width: var(--v1560qbr-2-w);
    }

    .v1560qbr-3-css-prop-3 {
      height: var(--v1560qbr-2-w);
    }
    "
  `);
});

test('should not treat scoped names in urls and strings of style prop values as variables', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const App = () => (
        <div style={{ backgroundImage: 'url(/---asset.png)', content: '"---title"' }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = () => (
      <div
        style={{
          backgroundImage: "url(/---asset.png)",
          content: '"---title"',
        }}
      />
    );
    "
  `);
});

test('should throw for computed scoped variable keys in attrs', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        export const Card = styled.div.attrs({
          style: { ['---' + 'color']: 'red' },
        })\`color: var(---color);\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: styled.*.attrs() cannot set scoped variables, set them in the \`style\` prop where the component is rendered
    loc: 4:12]
  `);
});

test('should throw for scoped variables read in conditional style prop values', async () => {
  const source = (value: string) => dedent`
    export const App = ({ active, name }) => (
      <div css={\`---accent: red; color: var(---accent);\`} style={{ color: ${value} }} />
    )
  `;

  await expect(
    transformWithFormat({ source: source("active ? 'var(---accent)' : 'red'") }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped variables can't be read in \`style\` prop values, they are not renamed there, read them in the styles of the element
    loc: 2:79]
  `);

  await expect(
    transformWithFormat({ source: source("active && 'var(---accent)'") }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped variables can't be read in \`style\` prop values, they are not renamed there, read them in the styles of the element
    loc: 2:80]
  `);

  await expect(
    transformWithFormat({ source: source('`var(---${name})`') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped variables can't be read in \`style\` prop values, they are not renamed there, read them in the styles of the element
    loc: 2:70]
  `);
});

test('should throw for computed scoped variable keys in nested style objects', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        export const App = ({ name }) => (
          <div
            css={\`---size: 5px; width: var(---size);\`}
            style={{ ...{ [\`---\${name}\`]: '10px' } }}
          />
        )
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped variables must be keys of an inline \`style={{ ... }}\` object to be renamed
    loc: 4:19]
  `);
});
