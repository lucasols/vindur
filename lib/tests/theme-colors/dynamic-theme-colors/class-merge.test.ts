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
          className: "v1560qbr-1-css-prop-1 base",
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

      const Component = ({ active, size }) => (
        <div
          className={css\`
            ---size: 1px;
            color: \${color.contrast.var};
          \`}
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
    const Component = ({ active, size }) => (
      <div
        {...color._sp(null, {
          className: [
            cx({
              active: active,
            }),
            "v1560qbr-2",
          ]
            .filter(Boolean)
            .join(" "),
          style: {
            "--v1560qbr-3-size": size,
          },
        })}
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2 {
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
          style: mergeStyles([
            {
              style: {
                padding: 1,
              },
            },
            props,
          ]),
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
