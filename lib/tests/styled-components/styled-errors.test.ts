import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

const importAliases = { '#/': '/' };
const emptyFs = createFsMock({});

describe('styled components - error handling', () => {
  test('should throw error for object property access', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const theme = { primary: 'blue' }
      const StyledDiv = styled.div\`
        color: \${theme.primary};
      \`
    `;

    await expect(async () => {
      await transformWithFormat({
        source,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: Invalid interpolation used at \`... StyledDiv = styled\` ... \${theme.primary}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
      loc: 5:11]
    `,
    );
  });

  test('should throw error for undefined variable references', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const StyledDiv = styled.div\`
        color: \${undefinedVariable};
      \`
    `;

    await expect(async () => {
      await transformWithFormat({
        source,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: Invalid interpolation used at \`... StyledDiv = styled\` ... \${undefinedVariable}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
      loc: 4:11
      ignoreInLint: true]
    `,
    );
  });

  test('should throw error for styled components assigned to a destructuring pattern', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const { displayName } = styled.div\`
            color: red;
          \`
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: Inline styled component usage is not supported. Please assign styled components to a variable first.
      loc: 3:24]
    `);
  });

  test('should throw error for default exported styled extensions', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'
          import { Card } from '#/components'

          export default styled(Card)\`
            color: red;
          \`
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: Inline styled component usage is not supported. Please assign styled components to a variable first.
      loc: 4:15]
    `);
  });

  test('should throw error for chained attrs calls', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          export const Button = styled.button
            .attrs({ type: 'button' })
            .attrs({ title: 'ok' })\`
            color: red;
          \`
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: Chained .attrs() calls are not supported, combine them into a single .attrs({...}) object
      loc: 3:22]
    `);
  });
});

test('should throw for vindur declarations not using const', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        let base = css\`color: red;\`

        export const Box = styled.div\`\${base};\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Vindur declarations must use \`const\`, not \`let\`, they are evaluated at compile time
    loc: 3:0]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        export var Box = styled.div\`color: red;\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Vindur declarations must use \`const\`, not \`var\`, they are evaluated at compile time
    loc: 3:7]
  `);
});
