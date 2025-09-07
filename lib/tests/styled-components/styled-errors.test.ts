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
      loc: {
        "column": 11,
        "filename": undefined,
        "line": 5,
      }]
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
      loc: {
        "column": 11,
        "filename": undefined,
        "line": 4,
      }
      ignoreInLint: true]
    `,
    );
  });
});
