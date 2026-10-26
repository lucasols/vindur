import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

test('should error on imported values that are not static', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { INSET } from '#/styles';

        export const Box = styled.div\`
          top: \${INSET}px;
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          const getInset = () => 8;

          export const INSET = getInset();
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "INSET" imported from /styles.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated
    loc: 5:9]
  `);
});

test('should error on values derived from imported values that are not static', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { INSET } from '#/styles';

        const SIZE = \`\${INSET}px\`;

        export const Box = styled.div\`
          top: \${SIZE};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          const getInset = () => 8;

          export const INSET = getInset();
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... Box = styled\` ... \${SIZE}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
    loc: 7:9
    ignoreInLint: true]
  `);
});
