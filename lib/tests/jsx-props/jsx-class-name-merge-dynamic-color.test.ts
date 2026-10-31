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
          dynamicColor={dynamicColor.set("#ff6b6b")}
        >
          Content
        </Container>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const dynamicColor = createDynamicCssColor("v1560qbr-1-dynamicColor", true);
    const App = ({ isActive }: { isActive: boolean }) => (
      <div
        {...dynamicColor._sp("#ff6b6b", {
          className:
            "base-style v1560qbr-2-Container v1560qbr-3-css-prop-3" +
            (isActive ? " v1560qbr-4-active" : ""),
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
        color: \${color.value};
      \`;

      export const A = () => (
        <Box css={\`padding: 1px;\`} dynamicColor={color.set('#f00')} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
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
    "import { createDynamicCssColor } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    export const A = ({ on, className }: { on: boolean; className?: string }) => (
      <>
        <div
          {...color._sp("#f00", {
            className: on ? "x" : "",
            style: {
              width: 1,
            },
          })}
        />
        <div
          {...color._sp("#f00", {
            className: (className || "") + (on ? " x" : ""),
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
    const color = createDynamicCssColor("v1560qbr-1-color", true);
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

test('should keep dynamicColor merges after every spread and css or cx prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur';

      const color = createDynamicCssColor();

      export const A = ({ on, p }: { on: boolean; p: object }) => (
        <>
          <div {...p} dynamicColor={color.set('#f00')} css={\`padding: 3px;\`} />
          <div className="x" cx={{ $on: on }} dynamicColor={color.set('#f00')} {...p} title="t" />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, mergeClassNames, mergeStyles } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    export const A = ({ on, p }: { on: boolean; p: object }) => (
      <>
        <div
          {...p}
          {...color._sp("#f00", {
            className: mergeClassNames([p], "v1560qbr-2-css-prop-2"),
            style: mergeStyles([p]),
          })}
        />
        <div
          {...p}
          title="t"
          {...color._sp("#f00", {
            className: mergeClassNames(["x", p], on ? "on" : ""),
            style: mergeStyles([p]),
          })}
        />
      </>
    );
    "
  `);
});

test('should keep an explicit style placed before spreads with dynamicColor', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur';

      const color = createDynamicCssColor();

      export const A = (props: { id: string }) => (
        <div style={{ display: 'none' }} {...props} dynamicColor={color.set('#f00')} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, mergeClassNames, mergeStyles } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    export const A = (props: { id: string }) => (
      <div
        {...props}
        {...color._sp("#f00", {
          className: mergeClassNames([props], ""),
          style: mergeStyles([props], {
            display: "none",
          }),
        })}
      />
    );
    "
  `);
});
