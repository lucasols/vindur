import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../../testUtils';

test('should merge the css prop class into dynamicColor', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur'

      const color = createDynamicCssColor()

      const App = () => (
        <div dynamicColor={color.set('#fff')} css={\`width: 1px;\`} />
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1", true);
    const App = () => (
      <div
        {...color._sp("#fff", {
          className: "v1560qbr-2-css-prop-2",
        })}
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2-css-prop-2 {
      width: 1px;
    }
    "
  `);
});

test('should merge the css prop class with className and dynamicColor', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur'

      const color = createDynamicCssColor()

      const App = ({ className }: { className: string }) => (
        <>
          <div className="card" dynamicColor={color.set('#fff')} css={\`width: 1px;\`} />
          <div className={className} dynamicColor={color.set('#fff')} css={\`width: 2px;\`} />
        </>
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1", true);
    const App = ({ className }: { className: string }) => (
      <>
        <div
          {...color._sp("#fff", {
            className: "card v1560qbr-2-css-prop-2",
          })}
        />
        <div
          {...color._sp("#fff", {
            className: (className || "") + " v1560qbr-3-css-prop-3",
          })}
        />
      </>
    );
    "
  `);
});

test('should merge the css prop class with spreads and dynamicColor', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur'

      const color = createDynamicCssColor()

      const App = (props: { className?: string }) => (
        <div
          {...props}
          style={{ padding: 4 }}
          dynamicColor={color.set('#fff')}
          css={\`width: 1px;\`}
        />
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, mergeClassNames } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1", true);
    const App = (props: { className?: string }) => (
      <div
        {...props}
        {...color._sp("#fff", {
          className: mergeClassNames([props], "v1560qbr-2-css-prop-2"),
          style: {
            padding: 4,
          },
        })}
      />
    );
    "
  `);
});

test('should merge the cx prop class into dynamicColor', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur'

      const color = createDynamicCssColor()

      const App = ({ active }: { active: boolean }) => (
        <div dynamicColor={color.set('#fff')} cx={{ $active: active }} />
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, cx } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1", true);
    const App = ({ active }: { active: boolean }) => (
      <div
        {...color._sp("#fff", {
          className: cx({
            active: active,
          }),
        })}
      />
    );
    "
  `);
});

test('should merge styled component, css and cx prop classes into dynamicColor', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Card = styled.div\`
        padding: 8px;
      \`

      const App = ({ active }: { active: boolean }) => (
        <Card
          dynamicColor={color.set('#fff')}
          cx={{ active }}
          css={\`&.active { width: 1px; }\`}
        />
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, cx } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1", true);
    const App = ({ active }: { active: boolean }) => (
      <div
        {...color._sp("#fff", {
          className:
            "v1560qbr-2-Card v1560qbr-3-css-prop-3 " +
            cx({
              "v1560qbr-4-active": active,
            }),
        })}
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2-Card {
      padding: 8px;
    }

    .v1560qbr-3-css-prop-3 {
      &.v1560qbr-4-active {
        width: 1px;
      }
    }
    "
  `);
});
