import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should resolve local object properties at any depth', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      const theme = {
        primary: 'blue',
        colorScheme: { container: { isDark: '.dm &' } },
      }

      const Card = styled.div\`
        color: \${theme.primary};
        \${theme.colorScheme.container.isDark} {
          color: white;
        }
      \`

      const App = () => <Card />
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const theme = {
      primary: "blue",
      colorScheme: {
        container: {
          isDark: ".dm &",
        },
      },
    };
    const App = () => <div className="v1560qbr-1-Card" />;
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Card {
      color: blue;
      .dm & {
        color: white;
      }
    }
    "
  `);
});

test('should throw error for missing property on a local object', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const theme = { colors: { primary: 'blue' } }
        const style = css\`
          color: \${theme.colors.secondary};
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... style = css\` ... \${theme.colors.secondary}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
    loc: 5:11]
  `);
});

test('should throw error for local object used as a value', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const theme = { colors: { primary: 'blue' } }
        const style = css\`
          color: \${theme.colors};
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... style = css\` ... \${theme.colors}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
    loc: 5:11]
  `);
});

test('should throw error for boolean interpolations', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const flags = { isDark: true }
        const style = css\`
          color: \${flags.isDark};
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... style = css\` ... \${flags.isDark}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
    loc: 5:11]
  `);
});

test('should throw error for undefined interpolations', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const color = undefined
        const style = css\`
          color: \${color};
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... style = css\` ... \${color}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
    loc: 5:11
    ignoreInLint: true]
  `);
});

test('should resolve local objects declared with as const or satisfies', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'

      const theme = { colors: { primary: 'blue' } } as const
      const spacing = { large: 24 } satisfies Record<string, number>

      const style = css\`
        color: \${theme.colors.primary};
        margin: \${spacing.large}px;
      \`
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const theme = {
      colors: {
        primary: "blue",
      },
    } as const;
    const spacing = {
      large: 24,
    } satisfies Record<string, number>;
    const style = "v1560qbr-1-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      color: blue;
      margin: 24px;
    }
    "
  `);
});
