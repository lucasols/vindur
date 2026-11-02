import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should throw for & joined with a name, also in pseudo-class arguments', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        export const style = css\`&-icon { color: red; }\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`&-icon\` is not supported, CSS nesting can't concatenate a suffix to the generated class name, use a separate class instead, e.g. \`&-active {}\` -> \`&.active {}\`
    loc: 2:25]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        export const style = css\`&:is(&-icon) { color: red; }\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`&-icon\` is not supported, CSS nesting can't concatenate a suffix to the generated class name, use a separate class instead, e.g. \`&-active {}\` -> \`&.active {}\`
    loc: 2:30]
  `);
});

test('should throw for placeholder selectors', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        export const style = css\`%base { color: red; }\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`%placeholder\` selectors are not supported, use a class or a \`css\` style
    loc: 2:25]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        export const style = css\`&:nth-child(2n of %base) { color: red; }\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`%placeholder\` selectors are not supported, use a class or a \`css\` style
    loc: 2:43]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        export const style = css\`&::slotted(%base) { color: red; }\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`%placeholder\` selectors are not supported, use a class or a \`css\` style
    loc: 2:36]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'
        createGlobalStyle\`@scope (.card) to (%base) { img { color: red; } }\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`%placeholder\` selectors are not supported, use a class or a \`css\` style
    loc: 2:37]
  `);
});

test('should throw for nested selectors starting with a pseudo-class or pseudo-element without &', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        export const Container = styled.div\`
          > .scrollableContainer {
            ::-webkit-scrollbar {
              width: 0;
              height: 0;
            }
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`::-webkit-scrollbar\` is ambiguous, CSS nesting reads it as a descendant selector but stylis 3 (used by Linaria and styled-components v5) attaches it to the parent, write \`&::-webkit-scrollbar\` to match the parent itself or \`& ::-webkit-scrollbar\` to match its descendants
    loc: 4:4]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        export const Card = styled.div\`
          a {
            :hover {
              color: red;
            }
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`:hover\` is ambiguous, CSS nesting reads it as a descendant selector but stylis 3 (used by Linaria and styled-components v5) attaches it to the parent, write \`&:hover\` to match the parent itself or \`& :hover\` to match its descendants
    loc: 4:4]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        export const style = css\`&:hover, :focus-visible { color: red; }\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`:focus-visible\` is ambiguous, CSS nesting reads it as a descendant selector but stylis 3 (used by Linaria and styled-components v5) attaches it to the parent, write \`&:focus-visible\` to match the parent itself or \`& :focus-visible\` to match its descendants
    loc: 2:34]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        const hover = ':hover'
        export const style = css\`\${hover} { color: red; }\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`:hover\` is ambiguous, CSS nesting reads it as a descendant selector but stylis 3 (used by Linaria and styled-components v5) attaches it to the parent, write \`&:hover\` to match the parent itself or \`& :hover\` to match its descendants (found in the interpolated value)
    loc: 3:27]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'
        createGlobalStyle\`body { ::selection { color: red; } }\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`::selection\` is ambiguous, CSS nesting reads it as a descendant selector but stylis 3 (used by Linaria and styled-components v5) attaches it to the parent, write \`&::selection\` to match the parent itself or \`& ::selection\` to match its descendants
    loc: 2:25]
  `);
});

test('should throw for nested selectors starting with a pseudo-class that contain & but match other elements', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        export const style = css\`:not(.collapsed &) { display: none; }\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`:not(.collapsed &)\` is ambiguous, CSS nesting doesn't attach a selector that contains \`&\` to the parent but stylis 3 (used by Linaria and styled-components v5) does, write \`&:not(.collapsed &)\` to match the parent itself. A leading \`:is()\` or \`:where()\` is only allowed when each of its selectors matches \`&\`, like \`:where(.dark &)\`
    loc: 2:25]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        export const style = css\`:is(.a, &) { color: red; }\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`:is(.a, &)\` is ambiguous, CSS nesting doesn't attach a selector that contains \`&\` to the parent but stylis 3 (used by Linaria and styled-components v5) does, write \`&:is(.a, &)\` to match the parent itself. A leading \`:is()\` or \`:where()\` is only allowed when each of its selectors matches \`&\`, like \`:where(.dark &)\`
    loc: 2:25]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        export const style = css\`:hover & { color: red; }\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`:hover &\` is ambiguous, CSS nesting doesn't attach a selector that contains \`&\` to the parent but stylis 3 (used by Linaria and styled-components v5) does, write \`&:hover &\` to match the parent itself. A leading \`:is()\` or \`:where()\` is only allowed when each of its selectors matches \`&\`, like \`:where(.dark &)\`
    loc: 2:25]
  `);
});

test('should allow nested pseudo selectors with & and top level pseudo selectors in global styles', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, createGlobalStyle } from 'vindur'

      const isDark = '.dm &, .dark-theme &'

      export const style = css\`
        & :hover { color: red; }
        :where(&.broken) { color: blue; }
        :where(body.x &), :is(.y &) { color: green; }
        :where(&.z):hover { color: purple; }
        .a:not(:hover, :focus-within) { color: gray; }
        [href]:hover { color: black; }
        \${isDark} { color: white; }
      \`

      createGlobalStyle\`
        :root { --x: red; }
        ::selection { color: var(--x); }
      \`
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const isDark = ".dm &, .dark-theme &";
    export const style = "v1560qbr-1-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      & :hover {
        color: red;
      }
      :where(&.broken) {
        color: blue;
      }
      :where(body.x &),
      :is(.y &) {
        color: green;
      }
      :where(&.z):hover {
        color: purple;
      }
      .a:not(:hover, :focus-within) {
        color: gray;
      }
      [href]:hover {
        color: black;
      }
      .dm &,
      .dark-theme & {
        color: white;
      }
    }

    :root {
      --x: red;
    }
    ::selection {
      color: var(--x);
    }
    "
  `);
});
