import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should merge cx, className and the css prop into dynamicColor', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled, createDynamicCssColor } from 'vindur';

      const dynamicColor = createDynamicCssColor();

      const Container = styled.div\`
        &.active {
          color: red;
        }
      \`;

      const App = ({ isActive }: { isActive: boolean }) => (
        <Container
          cx={{ active: isActive }}
          className="base-style"
          css={\`
            background: red;
          \`}
          dynamicColor={dynamicColor}
        >
          Content
        </Container>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, cx } from "vindur";
    const dynamicColor = createDynamicCssColor("v1560qbr-1", true);
    const App = ({ isActive }: { isActive: boolean }) => (
      <div
        {...dynamicColor._sp("#ff6b6b", {
          className:
            "base-style v1560qbr-2-Container v1560qbr-3-css-prop-3 " +
            cx({
              "v1560qbr-4-active": isActive,
            }),
        })}
      >
        Content
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2-Container {
      &.v1560qbr-4-active {
        color: red;
      }
    }

    .v1560qbr-3-css-prop-3 {
      background: red;
    }
    "
  `);
});

test('should keep the css prop class of a styled component with dynamicColor', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled, createDynamicCssColor } from 'vindur';

      const color = createDynamicCssColor();

      const Box = styled.div\`
        color: \${color.var};
      \`;

      export const A = () => (
        <Box css={\`padding: 1px;\`} dynamicColor={color.set('#f00')} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1", true);
    export const A = () => (
      <div
        {...color._sp("#f00", {
          className: "v1560qbr-2-Box v1560qbr-3-css-prop-3",
        })}
      />
    );
    "
  `);
});

test('should keep cx classes of native elements with dynamicColor', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur';

      const color = createDynamicCssColor();

      export const A = ({ on, className }: { on: boolean; className?: string }) => (
        <>
          <div cx={{ $x: on }} style={{ width: 1 }} dynamicColor={color.set('#f00')} />
          <div className={className} cx={{ $x: on }} dynamicColor={color.set('#f00')} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, cx } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1", true);
    export const A = ({ on, className }: { on: boolean; className?: string }) => (
      <>
        <div
          {...color._sp("#f00", {
            className: cx({
              x: on,
            }),
            style: {
              width: 1,
            },
          })}
        />
        <div
          {...color._sp("#f00", {
            className:
              (className || "") +
              " " +
              cx({
                x: on,
              }),
          })}
        />
      </>
    );
    "
  `);
});

test('should merge spread props and the css prop into dynamicColor', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur';

      const color = createDynamicCssColor();

      export const A = (props: { className?: string }) => (
        <>
          <div {...props} css={\`color: red;\`} dynamicColor={color.set('#f00')} />
          <div className="explicit" {...props} dynamicColor={color.set('#f00')} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, mergeClassNames, mergeStyles } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1", true);
    export const A = (props: { className?: string }) => (
      <>
        <div
          {...props}
          {...color._sp("#f00", {
            className: mergeClassNames([props], "v1560qbr-2-css-prop-2"),
            style: mergeStyles([props]),
          })}
        />
        <div
          {...props}
          {...color._sp("#f00", {
            className: mergeClassNames(["explicit", props], ""),
            style: mergeStyles([props]),
          })}
        />
      </>
    );
    "
  `);
});
