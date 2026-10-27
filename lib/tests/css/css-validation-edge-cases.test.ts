import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transform } from '../../src/transform';
import { createFsMock, transformWithFormat } from '../testUtils';

const styleKeyRegex = /"--[^"]*": w/;

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

// Not formatted, Prettier can't parse escaped custom property names
test('should set escaped scoped names in the style prop by their decoded name', () => {
  const result = transform({
    fileAbsPath: '/test.tsx',
    fs: createFsMock({}),
    transformFunctionCache: {},
    transformDynamicColorCache: {},
    importAliases: { '#/': '/' },
    dev: true,
    source: dedent`
      const App = ({ w }) => (
        <div css={\`---f\\6f o: 1px; width: var(---f\\6f o);\`} style={{ '---f\\6f o': w }} />
      )
    `,
  });

  // The style key is a valid JS string with the decoded name the CSS declares
  expect(result.code.match(styleKeyRegex)?.[0]).toMatchInlineSnapshot(
    `""--v1560qbr-2-foo": w"`,
  );

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-css-prop-1 {
      --v1560qbr-2-f\\6f o: 1px; width: var(--v1560qbr-2-f\\6f o);
    }"
  `);
});

test('should explain unquoted urls with invalid characters', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const icon = 'https://x.com/a(1).png'

        const style = css\`
          background: url(\${icon});
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: unquoted \`url()\` can't contain spaces, quotes or \`(\`, quote the url (found in the interpolated value)
    loc: 6:20]
  `);
});

test('should reject styled components used as style extensions', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Base = styled.div\`
          color: red;
        \`

        const Button = styled.button\`
          \${Base};
          width: 1px;
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`\${Base}\` is a class selector and can't be followed by \`;\`, use \`styled(Component)\` to extend a styled component's styles
    loc: 8:4]
  `);
});

test('should hint a missing `;` before a selector interpolation', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const highlighted = css\`outline: 1px solid;\`

        const Card = styled.div\`
          padding: 8px
          &\${highlighted} { color: red; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... Card = styled\`: missing \`;\` before a nested rule, \`padding: 8px &.v1560qbr-1-highlighted\` is not a valid selector
    loc: 6:2]
  `);
});

test('should reject a `;` after a global rule', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          body { margin: 0; };
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`createGlobalStyle\`: unexpected \`;\` after a rule, remove it
    loc: 4:21]
  `);
});

test('should accept class selectors followed by `;` inside strings and comments', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, styled } from 'vindur'

      const Base = styled.div\`
        color: red;
      \`

      const style = css\`
        content: "\${Base};";
        /* \${Base}; */
        color: blue;
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Base {
      color: red;
    }

    .v1560qbr-2-style {
      content: ".v1560qbr-1-Base;";
      /* .v1560qbr-1-Base; */
      color: blue;
    }
    "
  `);
});

test('should escape quotes of class names merged with a dynamic color', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur'

      const color = createDynamicCssColor()

      const App = () => (
        <div className='a"b' dynamicColor={color.set('#fff')} />
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    const App = () => (
      <div
        {...color._sp("#fff", {
          className: 'a"b',
        })}
      />
    );
    "
  `);
});

test('should reject top level at-rules inside style rules', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          @font-face { font-family: x; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`@font-face\` is not supported inside \`css\` templates, move it to the top level of \`createGlobalStyle\`
    loc: 4:2]
  `);
});

test('should locate unsupported syntax after template escapes', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          content: "\\201C";
          &:hover { @keyframes a { from { opacity: 0; } } }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`@keyframes\` is not supported inside \`css\` templates, use the \`keyframes\` function instead
    loc: 5:12]
  `);
});

test('should throw for object and theme color interpolations without css text', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createStaticThemeColors } from 'vindur'

        const colors = createStaticThemeColors({ primary: '#f00' })

        const Component = () => <div css={\`color: \${colors.primary};\`} />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`css\` ... \${colors.primary}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
    loc: 5:44]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const sizes = { small: 4 }

        const style = css\`
          padding: \${sizes};
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... style = css\` ... \${sizes}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
    loc: 6:13
    ignoreInLint: true]
  `);
});
