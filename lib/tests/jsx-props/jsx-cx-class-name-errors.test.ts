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
    [TransformError: /test.tsx: class "active" on "Box" never matches its "&.active" styles, as the cx prop of "Box" hashes it. Use cx={{ active: true }} instead, or "$active" in the cx prop to keep the class name
    loc: 12:19]
  `);
});

test('should reject a hashed cx key in cx() calls, templates and conditionals of the className', async () => {
  await expect(
    transformWithFormat({ source: boxSource('{cx({ active: a })}') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "Box" never matches its "&.active" styles, as the cx prop of "Box" hashes it. Use cx={{ active: true }} instead, or "$active" in the cx prop to keep the class name
    loc: 12:25]
  `);
  await expect(transformWithFormat({ source: boxSource('{`x ${id} active`}') }))
    .rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "Box" never matches its "&.active" styles, as the cx prop of "Box" hashes it. Use cx={{ active: true }} instead, or "$active" in the cx prop to keep the class name
    loc: 12:28]
  `);
  await expect(
    transformWithFormat({ source: boxSource("{a ? 'active' : ''}") }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: class "active" on "Box" never matches its "&.active" styles, as the cx prop of "Box" hashes it. Use cx={{ active: true }} instead, or "$active" in the cx prop to keep the class name
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
