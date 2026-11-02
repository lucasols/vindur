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
    [TransformError: /test.tsx: \`::-webkit-scrollbar\` is ambiguous, CSS nesting reads it as a descendant selector, write \`&::-webkit-scrollbar\` to match the parent itself or \`& ::-webkit-scrollbar\` to match its descendants
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
    [TransformError: /test.tsx: \`:hover\` is ambiguous, CSS nesting reads it as a descendant selector, write \`&:hover\` to match the parent itself or \`& :hover\` to match its descendants
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
    [TransformError: /test.tsx: \`:focus-visible\` is ambiguous, CSS nesting reads it as a descendant selector, write \`&:focus-visible\` to match the parent itself or \`& :focus-visible\` to match its descendants
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
    [TransformError: /test.tsx: \`:hover\` is ambiguous, CSS nesting reads it as a descendant selector, write \`&:hover\` to match the parent itself or \`& :hover\` to match its descendants (found in the interpolated value)
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
    [TransformError: /test.tsx: \`::selection\` is ambiguous, CSS nesting reads it as a descendant selector, write \`&::selection\` to match the parent itself or \`& ::selection\` to match its descendants
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
    [TransformError: /test.tsx: \`:not(.collapsed &)\` is ambiguous, CSS nesting doesn't attach a selector that contains \`&\` to the parent, so it can match elements outside of it, write \`&:not(.collapsed &)\` to match the parent itself or \`*:not(.collapsed &)\` to keep the CSS nesting meaning. A leading \`:is()\` or \`:where()\` is allowed when each of its selectors has a single \`&\` and the rest of the selector has none, like \`:where(.dark &) .icon\`, or when it has no \`&\` and the selector ends with \`&\`, like \`:where(.dark) &\`
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
    [TransformError: /test.tsx: \`:is(.a, &)\` is ambiguous, CSS nesting doesn't attach a selector that contains \`&\` to the parent, so it can match elements outside of it, write \`&:is(.a, &)\` to match the parent itself or \`*:is(.a, &)\` to keep the CSS nesting meaning. A leading \`:is()\` or \`:where()\` is allowed when each of its selectors has a single \`&\` and the rest of the selector has none, like \`:where(.dark &) .icon\`, or when it has no \`&\` and the selector ends with \`&\`, like \`:where(.dark) &\`
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
    [TransformError: /test.tsx: \`:hover &\` is ambiguous, CSS nesting doesn't attach a selector that contains \`&\` to the parent, so it can match elements outside of it, write \`&:hover &\` to match the parent itself or \`*:hover &\` to keep the CSS nesting meaning. A leading \`:is()\` or \`:where()\` is allowed when each of its selectors has a single \`&\` and the rest of the selector has none, like \`:where(.dark &) .icon\`, or when it has no \`&\` and the selector ends with \`&\`, like \`:where(.dark) &\`
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

test('should allow a leading :where() anchored by & inside it or after it', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const fieldBgColor = createDynamicCssColor()

      const Tile = styled.div\`
        :where(\${fieldBgColor.container.isDark}) & {
          color: white;
        }
        :where(& .text) {
          color: gray;
        }
      \`

      export const Component = () => (
        <div dynamicColor={fieldBgColor.set('#000')}>
          <Tile />
        </div>
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const fieldBgColor = createDynamicCssColor("v1560qbr-1-fieldBgColor", true);
    export const Component = () => (
      <div {...fieldBgColor._sp("#000")}>
        <div className="v1560qbr-2-Tile" />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2-Tile {
      :where(.v1560qbr-1-fieldBgColor-container-isDark) & {
        color: white;
      }
      :where(& .text) {
        color: gray;
      }
    }
    "
  `);
});

test('should throw for a leading :where() with more than one & in a selector', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        const isDark = '.dm &, .lm .dm &'
        export const style = css\`:where(\${isDark} &) { color: red; }\`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`:where(.dm &, .lm .dm & &)\` is ambiguous, CSS nesting doesn't attach a selector that contains \`&\` to the parent, so it can match elements outside of it, write \`&:where(.dm &, .lm .dm & &)\` to match the parent itself or \`*:where(.dm &, .lm .dm & &)\` to keep the CSS nesting meaning. A leading \`:is()\` or \`:where()\` is allowed when each of its selectors has a single \`&\` and the rest of the selector has none, like \`:where(.dark &) .icon\`, or when it has no \`&\` and the selector ends with \`&\`, like \`:where(.dark) &\`
    loc: 3:25]
  `);
});

test('should allow pseudo selectors in top level and @media rules of global styles', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createGlobalStyle } from 'vindur'

      createGlobalStyle\`
        :where(body:not(.default-scrollbar)) {
          scrollbar-width: thin;
        }

        @media (min-width: 1024px) {
          :where(body.scrollbar-medium) {
            scrollbar-width: auto;
          }
        }
      \`
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`""`);

  expect(result.css).toMatchInlineSnapshot(`
    ":where(body:not(.default-scrollbar)) {
      scrollbar-width: thin;
    }

    @media (min-width: 1024px) {
      :where(body.scrollbar-medium) {
        scrollbar-width: auto;
      }
    }
    "
  `);
});
