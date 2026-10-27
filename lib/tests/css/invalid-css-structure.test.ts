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
    [TransformError: /test.tsx: \`@charset\`, \`@import\` and \`@namespace\` must come before every other style of the file, move this \`createGlobalStyle\` above the other styles or merge it into the first one
    loc: 7:0]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css, createGlobalStyle } from 'vindur'

        export const card = css\`
          padding: 0;
        \`

        const Global = createGlobalStyle\`
          @import url(reset.css);
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`@charset\`, \`@import\` and \`@namespace\` must come before every other style of the file, move this \`createGlobalStyle\` above the other styles or merge it into the first one
    loc: 7:15]
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

test('should throw for `@view-transition` outside the top level of createGlobalStyle', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          @view-transition {
            navigation: auto;
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`@view-transition\` is not supported inside \`css\` templates, move it to the top level of \`createGlobalStyle\`
    loc: 4:2]
  `);
});

test('should throw for exported createGlobalStyle', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        export const Global = createGlobalStyle\`
          body { margin: 0; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: createGlobalStyle can't be exported, its styles are added where it is declared, remove the \`export\`
    loc: 3:13]
  `);
});

test('should report declarations followed by `;` in createGlobalStyle as declarations', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          color: red;;
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`createGlobalStyle\`: declarations in createGlobalStyle need a rule, e.g. \`body { ... }\`
    loc: 4:2]
  `);
});

test('should throw for `!important` in keyframes', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        const fade = keyframes\`
          from { opacity: 0 !important; }
          to { opacity: 1; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... fade = keyframes\`: \`!important\` is ignored in keyframes, remove it
    loc: 4:9]
  `);
});

test('should throw for rules nested in declaration only at-rules of createGlobalStyle', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          @font-face {
            font-family: x;
            @media print {
              src: url(a.woff2);
            }
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`createGlobalStyle\`: \`@font-face\` can only contain declarations
    loc: 6:4]
  `);
});

test('should throw for createGlobalStyle outside the top level', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        export default createGlobalStyle\`
          body { margin: 0; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: createGlobalStyle can't be exported, its styles are added where it is declared, remove the \`export\`
    loc: 3:15]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        export function setup() {
          createGlobalStyle\`
            body { margin: 0; }
          \`
        }
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: createGlobalStyle can only be used at the top level of the module, as a statement or in its own \`const\` declaration
    loc: 4:2]
  `);
});

test('should throw for createGlobalStyle sharing a variable declaration', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        const Global = createGlobalStyle\`
          body { margin: 0; }
        \`, a = 1

        console.log(a)
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: createGlobalStyle must use its own variable declaration
    loc: 3:0]
  `);
});

test('should validate at-rules nested in @scope of global styles', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          @scope (.a) {
            color: red;
            @keyframes fade {
              from { opacity: 0 !important; }
            }
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`createGlobalStyle\`: \`!important\` is ignored in keyframes, remove it
    loc: 7:13]
  `);
});

test('should throw for an `@import` missing its `;` before the next rule', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'
        createGlobalStyle\`
          @import url('https://fonts.googleapis.com/css2?family=Inter')
          @import url('https://fonts.googleapis.com/css2?family=Roboto');
          body { margin: 0; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`createGlobalStyle\`: invalid \`@import\` conditions, a \`;\` may be missing before the next rule
    loc: 4:2]
  `);
});

test('should keep `@import` layers, supports conditions and media queries', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createGlobalStyle } from 'vindur'
      createGlobalStyle\`
        @import url(a.css) layer(base) supports(display: grid) screen and (orientation: landscape);
        @import "b.css" print;
        body { margin: 0; }
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    "@import url(a.css) layer(base) supports(display: grid) screen and
      (orientation: landscape);
    @import "b.css" print;
    body {
      margin: 0;
    }
    "
  `);
});

test('should accept a `;` after an escaped `;` in a layer name', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createGlobalStyle } from 'vindur'
      createGlobalStyle\`
        @layer foo\\\; ;
        body { margin: 0; }
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    "@layer foo\\;;
    body {
      margin: 0;
    }
    "
  `);
});

test('should allow `@import` after a global style with only comments', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createGlobalStyle } from 'vindur'
      createGlobalStyle\`
        /* reset */
      \`
      createGlobalStyle\`
        @import url(a.css);
        body { margin: 0; }
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    "/* reset */

    @import url(a.css);
    body {
      margin: 0;
    }
    "
  `);
});

test('should throw for references to a createGlobalStyle binding', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'
        const Global = createGlobalStyle\`
          body { margin: 0; }
        \`
        console.log(Global)
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`Global\` can't be referenced, createGlobalStyle returns nothing and its declaration is removed
    loc: 2:6]
  `);
});
