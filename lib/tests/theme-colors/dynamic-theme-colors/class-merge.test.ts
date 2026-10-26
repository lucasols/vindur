import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../../testUtils';

test('should merge css prop class and className of imported dynamic color', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { themeColor } from '#/colors'

      const Component = () => (
        <div
          className="base"
          css={\`
            background: \${themeColor.var};
          \`}
          dynamicColor={themeColor.set('#ff6b6b')}
        />
      );
    `,
    overrideDefaultFs: createFsMock({
      'colors.ts': dedent`
        import { createDynamicCssColor } from 'vindur'

        export const themeColor = createDynamicCssColor()
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { themeColor } from "#/colors";
    const Component = () => (
      <div
        {...themeColor._sp("#ff6b6b", {
          className: "base v1560qbr-1-css-prop-1",
        })}
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-css-prop-1 {
      background: var(--vip4ilp-1-themeColor);
    }
    "
  `);
});

test('should merge cx classes, css className and scoped style into the dynamic color props', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor, css } from 'vindur'

      const color = createDynamicCssColor()

      const cls = css\`
        ---size: 1px;
        color: \${color.contrast.var};
      \`

      const Component = ({ active, size }) => (
        <div
          className={cls}
          style={{ '---size': size }}
          cx={{ $active: active }}
          dynamicColor={color.set(null)}
        />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, cx } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    const cls = "v1560qbr-2-cls";
    const Component = ({ active, size }) => (
      <div
        {...color._sp(null, {
          className:
            cls +
            " " +
            cx({
              active: active,
            }),
          style: {
            "--v1560qbr-3-size": size,
          },
        })}
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2-cls {
      --v1560qbr-3-size: 1px;
      color: var(--v1560qbr-1-color-c);
    }
    "
  `);
});

test('should keep className and style before a spread as fallbacks', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Box = styled.div\`
        background: \${color.var};
      \`

      const Component = (props) => (
        <Box
          className="fallback"
          style={{ padding: 1 }}
          {...props}
          dynamicColor={color.set('#ff6b6b')}
        />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, mergeClassNames, mergeStyles } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    const Component = (props) => (
      <div
        {...props}
        {...color._sp("#ff6b6b", {
          className: mergeClassNames(["fallback", props], "v1560qbr-2-Box"),
          style: mergeStyles([props], {
            padding: 1,
          }),
        })}
      />
    );
    "
  `);
});

test('should keep the import of a dynamic color used in a custom component css prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { themeColor } from '#/colors'
      import { Custom } from '#/custom'

      const Component = () => <Custom css={themeColor.var} />;
    `,
    overrideDefaultFs: createFsMock({
      'colors.ts': dedent`
        import { createDynamicCssColor } from 'vindur'

        export const themeColor = createDynamicCssColor()
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { themeColor } from "#/colors";
    import { Custom } from "#/custom";
    const Component = () => <Custom css={themeColor.var} />;
    "
  `);
});

test('should not repeat the class of an exported styled component', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      export const Box = styled.div\`
        color: red;
      \`

      export const App = ({ c }) => <Box dynamicColor={color.set(c)} />
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, _vSC } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    export const Box = _vSC("div", "v1560qbr-2-Box");
    export const App = ({ c }) => <Box {...color._sp(c)} />;
    "
  `);
});
