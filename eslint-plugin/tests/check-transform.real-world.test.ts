 
import { dedent } from '@ls-stack/utils/dedent';
import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { checkTransformRule } from '../src/rules/check-transform';
import { createVindurTester, getErrorsWithMsgFromResult } from './utils/createTester';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

const { invalid } = createVindurTester({
  name: 'check-transform',
  rule: checkTransformRule,
});

const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockImplementation((path) => {
    throw new Error(`File not found: ${String(path)}`);
  });
});

describe('real-world regressions', () => {
  test('should report warnings for real-world helper usage patterns from agent-eval', async () => {
    mockExistsSync.mockImplementation((path) => {
      const pathStr = String(path);
      return pathStr.includes('/src/style/helpers.ts')
        || pathStr.includes('/src/style/colors.ts');
    });

    mockReadFileSync.mockImplementation((path) => {
      const pathStr = String(path);

      if (pathStr.includes('/src/style/helpers.ts')) {
        return dedent`
          import { css, vindurFn } from 'vindur';

          export const centerContent = css\`
            display: flex;
            align-items: center;
            justify-content: center;
          \`;

          export const kicker = css\`
            font-size: 10px;
            letter-spacing: 0.1em;
            text-transform: uppercase;
          \`;

          export const transition = vindurFn(
            ({
              property,
            }: { property?: string } = {}) => \`
              transition: 0.24s cubic-bezier(0.4, 0.0, 0.2, 1);
              \${property ? \`transition-property: \${property};\` : ''}
            \`,
          );
        `;
      }

      if (pathStr.includes('/src/style/colors.ts')) {
        return dedent`
          import { createStaticThemeColors } from 'vindur';

          export const colors = createStaticThemeColors({
            textMuted: '#6b6e76',
            text: '#16181d',
          });
        `;
      }

      throw new Error(`File not found: ${String(path)}`);
    });

    const { result } = await invalid({
      code: dedent`
        import { styled } from 'vindur';
        import { colors } from '#src/style/colors';
        import { centerContent, kicker, transition } from '#src/style/helpers';

        const Eyebrow = styled.div\`
          \${kicker}
          color: \${colors.textMuted.var};
        \`;

        const IconButtonRoot = styled.button<{ md: boolean }>\`
          \${centerContent}
          \${transition({ property: 'background, color' })}
          width: 28px;
        \`;

        const SectionLabel = styled.button<{ active: boolean }>\`
          \${kicker}
          \${transition({ property: 'color' })}
          appearance: none;
          color: \${colors.textMuted.var};
        \`;
      `,
      options: [
        {
          importAliases: {
            '#src': '/src',
          },
        },
      ],
    });

    expect(
      getErrorsWithMsgFromResult({
        ...result,
        messages: result.messages.filter((message) =>
          message.message.startsWith('Possible missing `;` after'),
        ),
      }),
    ).toMatchInlineSnapshot(`
      "
      - messageId: 'transformWarning'
        msg: 'Possible missing \`;\` after \`\${kicker}\`. CSS interpolations are treated as selectors unless they are followed by \`;\`, so use \`\${kicker};\` when extending styles.'
        loc: '6:5'
      - messageId: 'transformWarning'
        msg: 'Possible missing \`;\` after \`\${centerContent}\`. CSS interpolations are treated as selectors unless they are followed by \`;\`, so use \`\${centerContent};\` when extending styles.'
        loc: '11:5'
      - messageId: 'transformWarning'
        msg: 'Possible missing \`;\` after \`\${kicker}\`. CSS interpolations are treated as selectors unless they are followed by \`;\`, so use \`\${kicker};\` when extending styles.'
        loc: '17:5'
      "
    `);
  });
});
