import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should throw for a missing `;` between declarations', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          color: red
          width: 1px;
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: missing \`;\` after \`red\`
    loc: 4:9]
  `);
});

test('should throw for declarations at the root of createGlobalStyle', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          color: red;
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`createGlobalStyle\`: declarations in createGlobalStyle need a rule, e.g. \`body { ... }\`
    loc: 4:2]
  `);
});

test('should throw for declarations at the root of keyframes', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        const fade = keyframes\`
          opacity: 0;
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... fade = keyframes\`: keyframes can only contain keyframe blocks, e.g. \`from { ... } to { ... }\`
    loc: 4:2]
  `);
});

test('should throw for nested rules in keyframe blocks', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        const fade = keyframes\`
          from {
            &:hover {
              opacity: 0;
            }
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... fade = keyframes\`: keyframes can only contain declarations
    loc: 5:4]
  `);
});

test('should throw for an unclosed block in keyframes', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        const fade = keyframes\`
          from { opacity: 0 }
          to { opacity: 1
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... fade = keyframes\`: unclosed block before end of file
    loc: 5:5]
  `);
});

test('should throw for a stray `;` between keyframe blocks', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        const fade = keyframes\`
          from { opacity: 0; };
          to { opacity: 1; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... fade = keyframes\`: unexpected \`;\` after a rule, remove it
    loc: 4:22]
  `);
});

test('should throw for an unterminated at-rule at the end of createGlobalStyle', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          @import url(reset.css)
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`createGlobalStyle\`: missing \`;\` after \`@import\`, global styles are joined with other styles
    loc: 4:2]
  `);
});

test('should throw for `@import` after a rule in createGlobalStyle', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          body { margin: 0; }
          @import url(reset.css);
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`createGlobalStyle\`: \`@import\` must come before every rule in \`createGlobalStyle\`
    loc: 5:2]
  `);
});

test('should throw for `@import` inside a grouping rule in createGlobalStyle', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          @media print { @import url(print.css); }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`@import\` must come before every rule, move it to the top level of \`createGlobalStyle\`
    loc: 4:17]
  `);
});

test('should throw for `@import` in createGlobalStyle after other styles of the file', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, createGlobalStyle } from 'vindur'

        export const card = css\`
          padding: 0;
        \`

        createGlobalStyle\`
          @import url(reset.css);
          body { margin: 0; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`@charset\`, \`@import\` and \`@namespace\` must come before every other style of the file, move this \`createGlobalStyle\` above the other styles
    loc: 7:0]
  `);
});

test('should keep `@import` of the first createGlobalStyle of the file', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, createGlobalStyle } from 'vindur'

      createGlobalStyle\`
        @import url(reset.css);
        body { margin: 0; }
      \`

      export const card = css\`
        padding: 0;
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    "@import url(reset.css);
    body {
      margin: 0;
    }

    .v1560qbr-2-card {
      padding: 0;
    }
    "
  `);
});

test('should throw for `//` comments in createGlobalStyle', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          body {
            // it's the body
            color: red;
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`createGlobalStyle\`: \`//\` comments are not supported in CSS, use \`/* ... */\`
    loc: 5:4]
  `);
});
