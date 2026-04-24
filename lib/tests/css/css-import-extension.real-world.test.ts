import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import { transform } from '../../src/transform';
import type { TransformWarning } from '../../src/transform';
import { createFsMock } from '../testUtils';

test('should warn for real-world helper usage patterns from agent-eval', () => {
  const warnings: TransformWarning[] = [];
  const fs = createFsMock({
    src: {
      style: {
        'helpers.ts': dedent`
          import { css, vindurFn } from 'vindur'

          export const centerContent = css\`
            display: flex;
            align-items: center;
            justify-content: center;
          \`

          export const kicker = css\`
            font-size: 10px;
            letter-spacing: 0.1em;
            text-transform: uppercase;
          \`

          export const transition = vindurFn(
            ({
              property,
            }: { property?: string } = {}) => \`
              transition: 0.24s cubic-bezier(0.4, 0.0, 0.2, 1);
              \${property ? \`transition-property: \${property};\` : ''}
            \`,
          )
        `,
        'colors.ts': dedent`
          import { createStaticThemeColors } from 'vindur'

          export const colors = createStaticThemeColors({
            textMuted: '#6b6e76',
            text: '#16181d',
          })
        `,
      },
    },
  });

  transform({
    fileAbsPath: '/src/components.tsx',
    fs,
    transformFunctionCache: {},
    transformDynamicColorCache: {},
    importAliases: { '#src': '/src' },
    source: dedent`
      import { styled } from 'vindur'
      import { colors } from '#src/style/colors'
      import { centerContent, kicker, transition } from '#src/style/helpers'

      const Eyebrow = styled.div\`
        \${kicker}
        color: \${colors.textMuted.var};
      \`

      const IconButtonRoot = styled.button<{ md: boolean }>\`
        \${centerContent}
        \${transition({ property: 'background, color' })}
        width: 28px;
      \`

      const SectionLabel = styled.button<{ active: boolean }>\`
        \${kicker}
        \${transition({ property: 'color' })}
        appearance: none;
        color: \${colors.textMuted.var};
      \`
    `,
    dev: true,
    onWarning: (warning) => warnings.push(warning),
  });

  expect(
    compactSnapshot(
      warnings.filter((warning) =>
        warning.message.startsWith('Possible missing `;` after'),
      ),
    ),
  ).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: 'Possible missing \`;\` after \`\${kicker}\`. CSS interpolations are treated as selectors unless they are followed by \`;\`, so use \`\${kicker};\` when extending styles.'
        loc: 'current_file:6:4'
    - TransformWarning#:
        message: 'Possible missing \`;\` after \`\${centerContent}\`. CSS interpolations are treated as selectors unless they are followed by \`;\`, so use \`\${centerContent};\` when extending styles.'
        loc: 'current_file:11:4'
    - TransformWarning#:
        message: 'Possible missing \`;\` after \`\${kicker}\`. CSS interpolations are treated as selectors unless they are followed by \`;\`, so use \`\${kicker};\` when extending styles.'
        loc: 'current_file:17:4'
    "
  `);
});
