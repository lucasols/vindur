import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

function boxSource(className: string) {
  return dedent`
    import { styled, cx } from 'vindur';

    const Box = styled.div\`
      &.active {
        color: blue;
      }
    \`;

    export const A = ({ active, a, id }: { active: boolean; a: boolean; id: string }) => (
      <>
        <Box cx={{ active }} />
        <Box className=${className} />
      </>
    );
  `;
}

test('should reject a hashed cx key in a className string of the same styled component', async () => {
  await expect(transformWithFormat({ source: boxSource('"item active"') }))
    .rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "Box" never matches the "&.active" styles, as the cx prop of "Box" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 12:19]
  `);
});

test('should reject a hashed cx key in cx() calls, templates and conditionals of the className', async () => {
  await expect(
    transformWithFormat({ source: boxSource('{cx({ active: a })}') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "Box" never matches the "&.active" styles, as the cx prop of "Box" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 12:25]
  `);
  await expect(transformWithFormat({ source: boxSource('{`x ${id} active`}') }))
    .rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "Box" never matches the "&.active" styles, as the cx prop of "Box" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 12:28]
  `);
  await expect(
    transformWithFormat({ source: boxSource("{a ? 'active' : ''}") }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "Box" never matches the "&.active" styles, as the cx prop of "Box" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 12:24]
  `);
});

test('should allow classes joined to an expression and the class on other styled components', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        &.active {
          color: blue;
        }
      \`;

      const Tab = styled.div\`
        &.active {
          color: red;
        }
      \`;

      export const A = ({ active, id }: { active: boolean; id: string }) => (
        <>
          <Box cx={{ active }} />
          <Box className={\`x-\${id}active\`} />
          <Tab className="active" />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = ({ active, id }: { active: boolean; id: string }) => (
      <>
        <div className={"v1560qbr-1-Box" + (active ? " v1560qbr-3-active" : "")} />
        <div className={\`v1560qbr-1-Box \${\`x-\${id}active\`}\`} />
        <div className="v1560qbr-2-Tab active" />
      </>
    );
    "
  `);
});

test('should reject a hashed cx key in type casts, nested cx() objects, computed keys and JSX entities', async () => {
  await expect(
    transformWithFormat({ source: boxSource("{'active' as const}") }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "Box" never matches the "&.active" styles, as the cx prop of "Box" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 12:20]
  `);
  await expect(
    transformWithFormat({ source: boxSource('{cx(a && { active: true })}') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "Box" never matches the "&.active" styles, as the cx prop of "Box" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 12:30]
  `);
  await expect(
    transformWithFormat({ source: boxSource("{cx({ ['active']: a })}") }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "Box" never matches the "&.active" styles, as the cx prop of "Box" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 12:26]
  `);
  await expect(transformWithFormat({ source: boxSource('"&#97;ctive"') }))
    .rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "Box" never matches the "&.active" styles, as the cx prop of "Box" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 12:19]
  `);
});

test('should allow disabled cx() classes', async () => {
  const result = await transformWithFormat({
    source: boxSource("{cx({ active: false }, 'item')}"),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = ({
      active,
      a,
      id,
    }: {
      active: boolean;
      a: boolean;
      id: string;
    }) => (
      <>
        <div className={"v1560qbr-1-Box" + (active ? " v1560qbr-2-active" : "")} />
        <div className={"v1560qbr-1-Box " + ("item" || "")} />
      </>
    );
    "
  `);
});

test('should reject a hashed cx key in the className of the element with a css prop', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        export const A = ({ a }: { a: boolean }) => (
          <div css={\`&.active { color: red; }\`} cx={{ active: a }} className="active" />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "div" never matches the "&.active" styles, as the cx prop of "div" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 2:69]
  `);
});

test('should reject a hashed cx key in the attrs className of the styled component', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Box = styled.div.attrs({ className: 'active' })\`
          &.active {
            color: blue;
          }
        \`;

        export const A = ({ active }: { active: boolean }) => <Box cx={{ active }} />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" in the .attrs() of "Box" never matches the "&.active" styles of "Box", as its cx prop hashes it. Remove it from .attrs() and add it with the cx prop where it's needed, or use "$active" in the cx prop to keep the class name
    loc: 3:42]
  `);
});

test('should reject a hashed cx key in the attrs className of a styled component it extends', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Base = styled.div.attrs({ className: 'active' })\`
          color: red;
        \`;

        const Box = styled(Base)\`
          &.active {
            color: blue;
          }
        \`;

        export const A = ({ active }: { active: boolean }) => <Box cx={{ active }} />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" in the .attrs() of "Base" never matches the "&.active" styles of "Box", as its cx prop hashes it. Remove it from .attrs() and add it with the cx prop where it's needed, or use "$active" in the cx prop to keep the class name
    loc: 3:43]
  `);
});

test('should reject a css reference with hashed modifiers in the attrs className', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur';

        const card = css\`
          &.active {
            color: blue;
          }
        \`;

        const Box = styled.div.attrs({ className: card })\`
          &.active {
            color: red;
          }
        \`;

        export const A = ({ active }: { active: boolean }) => <Box cx={{ active }} />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: css reference "card" in the .attrs() className of "Box" declares the "&.active" modifier, which the cx prop of "Box" hashes, so it never matches the elements of "Box". Move the modifier styles into the styled component, or use "$active" in the cx prop to keep the class name
    loc: 9:42]
  `);
});

test('should reject a css reference in the attrs className with modifiers another element hashes', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur';

        const card = css\`
          &.active {
            color: blue;
          }
        \`;

        const Box = styled.div.attrs({ className: card })\`
          color: red;
        \`;

        export const A = ({ active }: { active: boolean }) => (
          <>
            <div className={card} cx={{ active }} />
            <Box />
          </>
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: css reference "card" in the .attrs() className of "Box" declares the "&.active" modifier, which the cx prop of "div" hashes, so it never matches the elements of "Box". Move the modifier styles into the styled component, or use "$active" in the cx prop to keep the class name
    loc: 9:42]
  `);
});

test('should allow a hashed cx key of a css reference interpolated in a css prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';

      const card = css\`
        &.active {
          color: blue;
        }
      \`;

      export const A = ({ active }: { active: boolean }) => (
        <>
          <div className={card} cx={{ active }} />
          <div css={\`\${card}; color: red;\`} className="active" />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const card = "v1560qbr-1-card";
    export const A = ({ active }: { active: boolean }) => (
      <>
        <div className={card + (active ? " v1560qbr-2-active" : "")} />
        <div className="active v1560qbr-3-css-prop-3" />
      </>
    );
    "
  `);
});

test('should reject a hashed cx key of a css reference in the className of other elements using it', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, cx } from 'vindur';

        const card = css\`
          &.active {
            color: blue;
          }
        \`;

        export const A = ({ active, other }: { active: boolean; other: boolean }) => (
          <>
            <div className={card} cx={{ active }} />
            <div className={cx(card, { active: other })} />
          </>
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "div" never matches the "&.active" styles of the css reference "card", as the cx prop of "div" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 12:31]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';

        const card = css\`
          &.active {
            color: blue;
          }
        \`;

        export const A = ({ active }: { active: boolean }) => (
          <>
            <div className={card} cx={{ active }} />
            <div className={\`\${card} active\`} />
          </>
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "div" never matches the "&.active" styles of the css reference "card", as the cx prop of "div" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 12:28]
  `);
});

test('should reject a hashed cx key in template interpolations between classes', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Box = styled.div\`
          &.active {
            color: blue;
          }
        \`;

        export const A = ({ active, other }: { active: boolean; other: boolean }) => (
          <>
            <Box cx={{ active }} />
            <Box className={\`item \${other ? 'active' : ''}\`} />
          </>
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "Box" never matches the "&.active" styles, as the cx prop of "Box" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 12:36]
  `);
});

test('should quote hyphenated keys in the suggested cx prop', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Box = styled.div\`
          &.is-active {
            color: blue;
          }
        \`;

        export const A = ({ active }: { active: boolean }) => (
          <>
            <Box cx={{ 'is-active': active }} />
            <Box className="is-active" />
          </>
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "is-active" on "Box" never matches the "&.is-active" styles, as the cx prop of "Box" hashes it. Add it with the cx prop instead, e.g. cx={{ "is-active": condition }}, or use "$is-active" in the cx prop to keep the class name
    loc: 12:19]
  `);
});

test('should reject a hashed cx key of a css reference declared in other styles of it', async () => {
  const header = dedent`
    import { css, cx, createGlobalStyle } from 'vindur';

    const base = css\`
      color: red;
    \`;

    createGlobalStyle\`
      \${base} {
        &.active {
          outline: 1px solid;
        }
      }
    \`;
  `;

  await expect(
    transformWithFormat({
      source: dedent`
        ${header}

        export const A = ({ active }: { active: boolean }) => (
          <>
            <div className={base} cx={{ active }} />
            <div className={cx(base, 'active')} />
          </>
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "div" never matches the "&.active" styles of the css reference "base", as the cx prop of "div" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 18:29]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        ${header}

        export const A = ({ active }: { active: boolean }) => (
          <>
            <div className={base} cx={{ active }} />
            <div css={base} className="active" />
          </>
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "div" never matches the "&.active" styles of the css reference "base", as the cx prop of "div" hashes it. Add it with the cx prop instead, e.g. cx={{ active: condition }}, or use "$active" in the cx prop to keep the class name
    loc: 18:30]
  `);
});

test('should allow a static class of a cx key hashed on an element with a css reference that has no rules for it', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, cx } from 'vindur';

      const base = css\`
        color: red;
      \`;

      export const A = ({ active }: { active: boolean }) => (
        <>
          <div
            css={\`
              &.active {
                color: blue;
              }
            \`}
            className={base}
            cx={{ active }}
          />
          <div className={cx(base, 'active')} />
        </>
      );
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-base {
      color: red;
    }

    .v1560qbr-2-css-prop-2 {
      &.v1560qbr-3-active {
        color: blue;
      }
    }
    "
  `);
});
