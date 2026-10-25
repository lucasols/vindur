import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transform } from '../../src/transform';
import { createFsMock, transformWithFormat } from '../testUtils';

// Not formatted, Prettier can't parse escaped custom property names
test('should accept escapes in unquoted urls and custom property names', () => {
  const result = transform({
    fileAbsPath: '/test.tsx',
    fs: createFsMock({}),
    transformFunctionCache: {},
    transformDynamicColorCache: {},
    importAliases: { '#/': '/' },
    dev: true,
    source: dedent`
      import { css } from 'vindur'

      const style = css\`
        background: url(foo\\20 bar.png);
        \\2d -config: theme: dark;
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      background: url(foo\\20 bar.png);
      \\2d -config: theme: dark;
    }"
  `);
});

test('should hint a missing `;` inside a rule with a type selector', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, createGlobalStyle } from 'vindur'

        const base = css\`overflow: hidden;\`

        createGlobalStyle\`
          body {
            \${base}
            width: 1px;
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Missing \`;\` after \`\${base}\`. CSS interpolations are treated as selectors unless they are followed by \`;\`, so use \`\${base};\` when extending styles.
    loc: 7:6]
  `);
});

test('should accept a comment before the `;` of a style extension', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'

      const base = css\`overflow: hidden;\`

      const style = css\`
        \${base} /* reset */;
        width: 1px;
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-base {
      overflow: hidden;
    }

    .v1560qbr-2-style {
      overflow: hidden; /* reset */
      width: 1px;
    }
    "
  `);
});

test('should show layer() calls in invalid selector errors', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, layer } from 'vindur'

        const style = css\`
          color: red
          \${layer('base')} {
            color: blue;
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: missing \`;\` before a nested rule, \`color: red \${layer('base')}\` is not a valid selector
    loc: 4:2]
  `);
});

test('should throw when layer() is not the only selector of its rule', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, layer } from 'vindur'

        const style = css\`
          \${layer('base')} a {
            color: blue;
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: layer() must be the only selector of its rule, e.g. \`\${layer('name')} { ... }\`
    loc: 4:4]
  `);
});

test('should throw when layer() is used inside a string', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, layer } from 'vindur'

        const style = css\`
          content: '\${layer('base')}';
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: layer() can only be used as the selector of a rule, e.g. \`\${layer('name')} { ... }\`
    loc: 4:14]
  `);
});

test('should locate errors spanning lines in CRLF files', async () => {
  await expect(
    transformWithFormat({
      source:
        "import { css } from 'vindur'\r\n\r\nconst style = css`\r\n  color: red\r\n  &:hover { color: blue; }\r\n`\r\n",
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: missing \`;\` before a nested rule, \`color: red &:hover\` is not a valid selector
    loc: 4:2]
  `);
});
