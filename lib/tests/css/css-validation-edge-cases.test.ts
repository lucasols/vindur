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

// Not formatted, Prettier can't parse escaped custom property names
test('should throw for escaped scoped names', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          ---f\\6f o: 1px;
          width: var(---foo);
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped name \`---f\\6f o\` can't contain escapes, write it without them
    loc: 4:2]
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
    [TransformError: /test.tsx: \`\${Base}\` is a class selector and can't be followed by \`;\`, use \`styled(Component)\` to extend a styled component's styles, or remove the \`;\` to use it as a selector
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

test('should throw for boolean and undefined interpolations', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const enabled = true

        export const style = css\`
          color: \${enabled};
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... style = css\` ... \${enabled}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
    loc: 6:11
    ignoreInLint: true]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const value = undefined
        const width = \`\${value}px\`

        export const style = css\`
          width: \${width};
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... style = css\` ... \${width}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
    loc: 7:11
    ignoreInLint: true]
  `);
});

test('should interpolate css constants in strings as their selector', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'

      const base = css\`
        color: red;
      \`

      const style = css\`
        &::before {
          content: '\${base};';
        }
      \`
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const base = "v1560qbr-1-base";
    const style = "v1560qbr-2-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-base {
      color: red;
    }

    .v1560qbr-2-style {
      &::before {
        content: ".v1560qbr-1-base;";
      }
    }
    "
  `);
});

test('should throw for a string ended by a carriage return', async () => {
  await expect(
    transformWithFormat({
      // A carriage return written in the source, `\r` would be a JavaScript escape
      source: dedent`
        import { css } from 'vindur'
        export const a = css\`
          &::before { content: "aCR b"; }
        \`
      `.replace('CR', '\r'),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... a = css\`: unclosed string, add \`"\`
    loc: 3:23]
  `);
});

test('should throw for a custom property missing its `;` before a nested rule', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        export const a = css\`
          ---accent: red
          &:hover { color: var(---accent); }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... a = css\`: missing \`;\` before a nested rule, a \`{ ... }\` block in a custom property must be its whole value
    loc: 3:13]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        export const a = css\`
          --x: a &:hover { color: red; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... a = css\`: missing \`;\` before a nested rule, a \`{ ... }\` block in a custom property must be its whole value
    loc: 3:17]
  `);
});

test('should throw for a custom property missing its `;` before the next declaration', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        export const style = css\`
          --x: 1
          color: red;
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: missing \`;\` after \`1\`
    loc: 4:7]
  `);
});

test('should throw for JavaScript escapes that drop the backslash of a CSS escape', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const icon = css\`
          &::before { content: "\e900"; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`\\e\` is a JavaScript escape in the template, write \`\\\\e\` for a CSS escape
    loc: 4:24]
  `);
});

test('should keep CSS escapes written with a double backslash', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'

      const icon = css\`
        &::before { content: "\\e900"; }
        &::after { content: "\\2014"; }
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-icon {
      &::before {
        content: "\\e900";
      }
      &::after {
        content: "\\2014";
      }
    }
    "
  `);
});

test('should throw for escapes JavaScript does not support in the template', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const icon = css\`
          &::before { content: "\\e900"; }
          &::after { content: "\2014"; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`\\2\` is a JavaScript escape in the template, write \`\\\\2\` for a CSS escape
    loc: 5:23]
  `);
});

test('should suggest a CSS escape of the hex code for JavaScript letter escapes', async () => {
  await expect(
    transformWithFormat({
      // \u2014 would be cooked by dedent
      source: dedent`
        import { css } from 'vindur';

        export const style = css\`
          &::before {
            content: "BSu2014";
          }
        \`;
      `.replace('BS', '\\'),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`\\u\` is a JavaScript escape in the template, write the character itself or a CSS escape of its hex code, like \`\\\\A\` for a line break or \`\\\\2014\` for \`—\`
    loc: 5:14]
  `);
});

test('should throw for quoted scoped names with a line continuation', async () => {
  await expect(
    transformWithFormat({
      // dedent drops the character after a backslash and a line break
      source: dedent`
        import { createGlobalStyle } from 'vindur';

        createGlobalStyle\`
          body {
            font-family: "---braBSBS
        nd";
          }
        \`;
      `.replace('BSBS', '\\\\'),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped name \`---bra\\
    nd\` can't contain escapes, write it without them
    loc: 5:18]
  `);
});

test('should throw for interpolated values that would end a string or comment', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        const TEXT = 'a" b'
        export const style = css\`content: "\${TEXT}";\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Values interpolated in a CSS string can't contain \`"\` or a line break, or end with \`\\\`, as they would end the string
    loc: 3:37]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        const TEXT = 'a */ color: red; /*'
        export const style = css\`/* \${TEXT} */ color: blue;\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Values interpolated in a CSS comment can't contain \`*/\`
    loc: 3:30]
  `);
});

test('should interpolate values in strings', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      const TEXT = 'hello'
      export const style = css\`&::after { content: "\${TEXT}"; }\`
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const TEXT = "hello";
    export const style = "v1560qbr-1-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      &::after {
        content: "hello";
      }
    }
    "
  `);
});

test('should throw for scoped names interpolated in strings', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        const NAME = '---spin'
        export const style = css\`animation-name: "\${NAME}";\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Interpolated values can't contain scoped variables like "---spin", write scoped variables directly in the template
    loc: 3:44]
  `);
});
