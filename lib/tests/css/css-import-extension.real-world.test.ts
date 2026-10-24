import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transform } from '../../src/transform';
import { createFsMock } from '../testUtils';

test('should throw for real-world helper usage patterns from agent-eval', () => {
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

  expect(() =>
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
    }),
  ).toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /src/components.tsx: Missing \`;\` after \`\${kicker}\`. CSS interpolations are treated as selectors unless they are followed by \`;\`, so use \`\${kicker};\` when extending styles.
    loc: 6:4]
  `);
});
