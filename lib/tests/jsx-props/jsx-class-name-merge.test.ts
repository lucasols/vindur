import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should skip an undefined className prop when merging with the cx prop on styled components', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        &.disabled {
          opacity: 0.5;
        }
      \`;

      export const A = ({ on, className }: { on: boolean; className?: string }) => (
        <Box className={className} cx={{ disabled: !on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = ({ on, className }: { on: boolean; className?: string }) => (
      <div
        className={
          (className || "") +
          " v1560qbr-1-Box" +
          (!on ? " v1560qbr-2-disabled" : "")
        }
      />
    );
    "
  `);
});

test('should skip an undefined className prop when merging with the cx prop on native elements', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = ({ on, className }: { on: boolean; className?: string }) => (
        <div className={className} cx={{ $disabled: !on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = ({ on, className }: { on: boolean; className?: string }) => (
      <div className={(className || "") + (!on ? " disabled" : "")} />
    );
    "
  `);
});

test('should keep the cx prop when merging the css prop with a className expression', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = ({ on, className }: { on: boolean; className?: string }) => (
        <div className={className} css={\`color: red;\`} cx={{ $disabled: !on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = ({ on, className }: { on: boolean; className?: string }) => (
      <div
        className={
          (className || "") + " v1560qbr-1-css-prop-1" + (!on ? " disabled" : "")
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-css-prop-1 {
      color: red;
    }
    "
  `);
});

test('should keep the cx prop when merging the css prop with a className string', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = ({ on }: { on: boolean }) => (
        <div className="base" css={\`color: red;\`} cx={{ $disabled: !on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = ({ on }: { on: boolean }) => (
      <div className={"base v1560qbr-1-css-prop-1" + (!on ? " disabled" : "")} />
    );
    "
  `);
});

test('should guard the whole className expression when merging with the cx prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = ({ on, c }: { on: boolean; c?: string }) => (
        <>
          <div className={on ? c : undefined} cx={{ $d: on }} />
          <div className={c ?? 'x'} cx={{ $d: on }} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = ({ on, c }: { on: boolean; c?: string }) => (
      <>
        <div className={((on ? c : undefined) || "") + (on ? " d" : "")} />
        <div className={((c ?? "x") || "") + (on ? " d" : "")} />
      </>
    );
    "
  `);
});

test('should concat a className expression with the css prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = ({ className }: { className?: string }) => (
        <div className={className} css={\`color: red;\`} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = ({ className }: { className?: string }) => (
      <div className={(className || "") + " v1560qbr-1-css-prop-1"} />
    );
    "
  `);
});

test('should keep the string value of a className literal when merging', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = ({ on }: { on: boolean }) => (
        <>
          <div className='a"b &amp; c
            d' css={\`color: red;\`} cx={{ $d: on }} />
          <div className='a"b' css={\`color: blue;\`} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = ({ on }: { on: boolean }) => (
      <>
        <div
          className={'a"b & c\\n      d v1560qbr-1-css-prop-1' + (on ? " d" : "")}
        />
        <div className='a"b v1560qbr-2-css-prop-2' />
      </>
    );
    "
  `);
});

test('should merge the cx prop and className with a css prop reference', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';

      const card = css\`
        &.active {
          color: red;
        }
      \`;

      export const A = ({ on, className }: { on: boolean; className?: string }) => (
        <div className={className} css={card} cx={{ active: on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const card = "v1560qbr-1-card";
    export const A = ({ on, className }: { on: boolean; className?: string }) => (
      <div
        className={
          (className || "") + " v1560qbr-1-card" + (on ? " v1560qbr-3-active" : "")
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-card {
      &.v1560qbr-3-active {
        color: red;
      }
    }
    "
  `);
});

test('should merge spread props with explicit className and import mergeClassNames', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = (props: { className?: string }) => (
        <>
          <div {...props} cx={{ $active: true }} />
          <div {...props} className="explicit" css={\`color: red;\`} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { mergeClassNames } from "vindur";
    export const A = (props: { className?: string }) => (
      <>
        <div {...props} className={mergeClassNames([props], "active")} />
        <div {...props} className="explicit v1560qbr-1-css-prop-1" />
      </>
    );
    "
  `);
});

test('should share cx modifier classes between elements using the same css reference', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';

      const card = css\`
        &.active {
          color: red;
        }
        &.active-extra {
          color: blue;
        }
      \`;

      export const A = ({ on, extra }: { on: boolean; extra: boolean }) => (
        <>
          <div css={card} cx={{ active: on, 'active-extra': extra }} />
          <div className={card} cx={{ active: !on }} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const card = "v1560qbr-1-card";
    export const A = ({ on, extra }: { on: boolean; extra: boolean }) => (
      <>
        <div
          className={
            "v1560qbr-1-card" +
            (on ? " v1560qbr-3-active" : "") +
            (extra ? " v1560qbr-4-active-extra" : "")
          }
        />
        <div className={card + (!on ? " v1560qbr-3-active" : "")} />
      </>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-card {
      &.v1560qbr-3-active {
        color: red;
      }
      &.v1560qbr-4-active-extra {
        color: blue;
      }
    }
    "
  `);
});

test('should rewrite cx modifiers inside layered css references', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, layer } from 'vindur';

      const card = css\`
        \${layer('base')} {
          &.active {
            color: red;
          }
        }
      \`;

      export const A = ({ on }: { on: boolean }) => (
        <div className={card} cx={{ active: on }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const card = "v1560qbr-1-card";
    export const A = ({ on }: { on: boolean }) => (
      <div className={card + (on ? " v1560qbr-2-active" : "")} />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    "@layer base {
      .v1560qbr-1-card {
        &.v1560qbr-2-active {
          color: red;
        }
      }
    }
    "
  `);
});

test('should concat className expressions on styled components', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled, createDynamicCssColor } from 'vindur';

      const color = createDynamicCssColor();

      const Box = styled.div\`
        color: \${color.value};
      \`;

      const Btn = styled.button<{ active: boolean }>\`
        &.active {
          color: red;
        }
      \`;

      export const A = ({ on, className }: { on: boolean; className?: string }) => (
        <>
          <Box className={className} />
          <Btn className={className} active />
          <Box className={className} dynamicColor={color.set('#f00')} />
          <Box className='a"b' dynamicColor={color.set('#f00')} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    export const A = ({ on, className }: { on: boolean; className?: string }) => (
      <>
        <div className={"v1560qbr-2-Box " + (className || "")} />
        <button
          className={
            "v1560qbr-3-Btn " + (className || "") + " v1560qbr-3-Btn-active"
          }
        />
        <div
          {...color._sp("#f00", {
            className: "v1560qbr-2-Box " + (className || ""),
          })}
        />
        <div
          {...color._sp("#f00", {
            className: 'v1560qbr-2-Box a"b',
          })}
        />
      </>
    );
    "
  `);
});

test('should merge a css call in the className of a styled component', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled, css, cx } from 'vindur';

      const Box = styled.div\`
        color: red;
      \`;

      export const A = ({ on }: { on: boolean }) => (
        <>
          <Box className={css\`height: 100%;\`} />
          <Box className={cx(css\`width: 100%;\`, on && 'x')} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const A = ({ on }: { on: boolean }) => (
      <>
        <div className={"v1560qbr-1-Box " + ("v1560qbr-2" || "")} />
        <div className={"v1560qbr-1-Box " + (cx("v1560qbr-3", on && "x") || "")} />
      </>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      color: red;
    }

    .v1560qbr-2 {
      height: 100%;
    }

    .v1560qbr-3 {
      width: 100%;
    }
    "
  `);
});

test('should merge a css call in the className with the cx prop and style flags', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled, css } from 'vindur';

      const Box = styled.div<{ active: boolean }>\`
        &.active {
          color: red;
        }
      \`;

      const Item = styled.div\`
        &.selected {
          color: blue;
        }
      \`;

      export const A = ({ on }: { on: boolean }) => (
        <>
          <Box active={on} className={css\`height: 100%;\`} />
          <Item className={css\`width: 100%;\`} cx={{ selected: on }} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = ({ on }: { on: boolean }) => (
      <>
        <div
          className={
            "v1560qbr-1-Box " +
            ("v1560qbr-4" || "") +
            (on ? " v1560qbr-1-Box-active" : "")
          }
        />
        <div
          className={
            ("v1560qbr-5" || "") +
            " v1560qbr-2-Item" +
            (on ? " v1560qbr-3-selected" : "")
          }
        />
      </>
    );
    "
  `);
});

test('should merge a css call in the className with the dynamicColor prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled, css, createDynamicCssColor } from 'vindur';

      const color = createDynamicCssColor();

      const Box = styled.div\`
        background: \${color.value};
      \`;

      export const A = () => (
        <Box className={css\`height: 100%;\`} dynamicColor={color.set('#fff')} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    export const A = () => (
      <div
        {...color._sp("#fff", {
          className: "v1560qbr-2-Box " + ("v1560qbr-3" || ""),
        })}
      />
    );
    "
  `);
});
