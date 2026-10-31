import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

describe(':global', () => {
  test('should throw for :global() selectors in css', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'

          const style = css\`
            :global(.dark) & {
              color: white;
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`:global\` is not supported, plain class selectors are not hashed so remove the wrapper, e.g. \`:global(.dark) &\` -> \`.dark &\`
      loc: 4:2]
    `);
  });

  test('should suggest createGlobalStyle for :global() selectors without &', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'

          const style = css\`
            :global(.ant-btn) {
              margin: 0;
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`:global\` is not supported, use \`createGlobalStyle\` for styles that should apply outside this component, or remove the wrapper to scope them to it, e.g. \`:global(.ant-btn)\` -> \`.ant-btn\`
      loc: 4:2]
    `);
  });

  test('should throw for :global blocks in styled components', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Box = styled.div\`
            padding: 4px;

            :global {
              .ant-btn { margin: 0; }
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`:global\` blocks are not supported, plain class selectors are not hashed so move the nested rules out of the block, e.g. \`:global { .ant-btn {} }\` -> \`.ant-btn {}\`
      loc: 6:2]
    `);
  });

  test('should throw for :global prefix selectors', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'

          const style = css\`
            :global .dark & {
              color: white;
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`:global\` is not supported, plain class selectors are not hashed so remove the wrapper, e.g. \`:global(.dark) &\` -> \`.dark &\`
      loc: 4:2]
    `);
  });

  test('should throw for :global in createGlobalStyle', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createGlobalStyle } from 'vindur'

          createGlobalStyle\`
            :global(body) { margin: 0; }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`:global\` is not supported, \`createGlobalStyle\` styles are already global so remove the wrapper, e.g. \`:global(body)\` -> \`body\`
      loc: 4:2]
    `);
  });

  test('should throw for :global coming from an interpolated vindurFn', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'
          import { inDarkMode } from '#/utils'

          const style = css\`
            \${inDarkMode('color: white;')}
          \`
        `,
        overrideDefaultFs: createFsMock({
          'utils.ts': dedent`
            import { vindurFn } from 'vindur'

            export const inDarkMode = vindurFn((styles: string) => \`:global(.dark) & { \${styles} }\`)
          `,
        }),
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`:global\` is not supported, plain class selectors are not hashed so remove the wrapper, e.g. \`:global(.dark) &\` -> \`.dark &\` (found in the interpolated value)
      loc: 5:4]
    `);
  });

  test('should ignore :global inside comments', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          /* migrated from :global(.dark) & */
          .dark & {
            color: white;
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        /* migrated from :global(.dark) & */
        .dark & {
          color: white;
        }
      }
      "
    `);
  });
  test('should throw for :global followed by a comma', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'

          const style = css\`
            :global, .other {
              color: white;
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`:global\` is not supported, use \`createGlobalStyle\` for styles that should apply outside this component, or remove the wrapper to scope them to it, e.g. \`:global(.ant-btn)\` -> \`.ant-btn\`
      loc: 4:2]
    `);
  });

  test('should throw for :global split by an interpolation', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'

          const name = 'global'

          const style = css\`
            :\${name}(.dark) & {
              color: white;
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`:global\` is not supported, plain class selectors are not hashed so remove the wrapper, e.g. \`:global(.dark) &\` -> \`.dark &\`
      loc: 6:2]
    `);
  });

  test('should report the source location of :global in CRLF files', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'

          const style = css\`
            .é:global(.dark) & {
              color: white;
            }
          \`
        `.replaceAll('\n', '\r\n'),
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`:global\` is not supported, plain class selectors are not hashed so remove the wrapper, e.g. \`:global(.dark) &\` -> \`.dark &\`
      loc: 4:4]
    `);
  });

  test('should throw for :global after a comment marker inside a string', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'

          const style = css\`
            content: "/*";

            :global(.dark) & {
              color: white;
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`:global\` is not supported, plain class selectors are not hashed so remove the wrapper, e.g. \`:global(.dark) &\` -> \`.dark &\`
      loc: 6:2]
    `);
  });

  test('should ignore :global and @keyframes inside strings and urls', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          content: ':global ';
          quotes: "@keyframes" "x";
          background: url(/img/:global.png);
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        content: ":global ";
        quotes: "@keyframes" "x";
        background: url(/img/:global.png);
      }
      "
    `);
  });

  test('should throw for :global with non ASCII characters', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'

          const style = css\`
            :global(.café) & {
              color: white;
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`:global\` is not supported, plain class selectors are not hashed so remove the wrapper, e.g. \`:global(.dark) &\` -> \`.dark &\`
      loc: 4:2]
    `);
  });

  test('should throw for uppercase :GLOBAL', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'

          const style = css\`
            :GLOBAL(.dark) & {
              color: white;
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`:global\` is not supported, plain class selectors are not hashed so remove the wrapper, e.g. \`:global(.dark) &\` -> \`.dark &\`
      loc: 4:2]
    `);
  });

  test('should ignore :global and @keyframes in declaration values', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          animation-name:global;
          font-family:global,Arial;
          --mode:var(--x,:global);
          font-family:global, Café;
          --x: @keyframes;

          @supports (--mode:global) {
            color: red;
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        animation-name: global;
        font-family: global, Arial;
        --mode: var(--x, : global);
        font-family: global, Café;
        --x: @keyframes;

        @supports (--mode: global) {
          color: red;
        }
      }
      "
    `);
  });

  test('should ignore :global inside comments split by interpolations', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const note = 'old'

        const style = css\`
          /* \${note} :global(.dark) & */
          color: red;
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const note = "old";
      const style = "v1560qbr-1-style";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        /* old :global(.dark) & */
        color: red;
      }
      "
    `);
  });
});

describe('@keyframes inside templates', () => {
  test('should throw for @keyframes in styled components', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Spinner = styled.div\`
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }

            animation: spin 1s linear infinite;
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`@keyframes\` is not supported inside \`styled\` templates, use the \`keyframes\` function instead
      loc: 4:2]
    `);
  });

  test('should throw for @keyframes in the css prop', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          const App = () => (
            <div css={\`
              @-webkit-keyframes fade { from { opacity: 0; } }
              animation: fade 1s;
            \`} />
          )
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`@-webkit-keyframes\` is not supported inside \`css\` templates, use the \`keyframes\` function instead
      loc: 3:4]
    `);
  });

  test('should allow top level @keyframes in createGlobalStyle', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          @keyframes fade {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes fade {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      "
    `);
  });

  test('should throw for the first vendor prefixed @keyframes', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'

          const style = css\`
            @-moz-keyframes a { from { opacity: 0; } }
            @keyframes b { from { opacity: 0; } }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`@-moz-keyframes\` is not supported inside \`css\` templates, use the \`keyframes\` function instead
      loc: 4:2]
    `);
  });

  test('should throw for @keyframes in keyframes templates', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { keyframes } from 'vindur'

          const fade = keyframes\`
            @keyframes inner {
              from { opacity: 0; }
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`@keyframes\` is not supported inside \`keyframes\` templates, they already generate the \`@keyframes\` rule so write only the frames, e.g. \`from { ... } to { ... }\`
      loc: 4:2]
    `);
  });

  test('should throw for @keyframes nested in style rules in createGlobalStyle', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createGlobalStyle } from 'vindur'

          createGlobalStyle\`
            .box {
              @KEYFRAMES spin { from { opacity: 0; } }
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`@KEYFRAMES\` is not supported inside style rules, move it to the top level of \`createGlobalStyle\`
      loc: 5:4]
    `);
  });

  test('should throw for @keyframes nested in non grouping at-rules in createGlobalStyle', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createGlobalStyle } from 'vindur'

          createGlobalStyle\`
            @keyframes outer {
              @keyframes inner { from { opacity: 0; } }
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`@keyframes\` is not supported inside \`@keyframes\` rules, move it to the top level of \`createGlobalStyle\`
      loc: 5:4]
    `);
  });

  test('should allow @keyframes nested in at-rules in createGlobalStyle', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          @media (prefers-reduced-motion: no-preference) {
            @keyframes fade {
              from { opacity: 0; }
            }
          }

          @supports (--theme: {color:red}) {
            @keyframes slide { from { opacity: 0; } }
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      "@media (prefers-reduced-motion: no-preference) {
        @keyframes fade {
          from {
            opacity: 0;
          }
        }
      }

      @supports (--theme: {color: red}) {
        @keyframes slide {
          from {
            opacity: 0;
          }
        }
      }
      "
    `);
  });
});

describe('& suffix concatenation', () => {
  test('should throw for &-- suffixes in createGlobalStyle', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createGlobalStyle } from 'vindur'

          createGlobalStyle\`
            .react-datepicker__day {
              &--today { font-weight: bold; }
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`&--today\` is not supported, CSS nesting can't concatenate a suffix to the parent selector, write the full selector in its own rule instead, e.g. \`.day { &--today {} }\` -> \`.day--today {}\`
      loc: 5:4]
    `);
  });

  test('should throw for &__ suffixes in styled components', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Card = styled.div\`
            .card {
              &:hover { color: red; }
              & > .title, &__body { padding: 4px; }
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`&__body\` is not supported, CSS nesting can't concatenate a suffix to the parent selector, write the full selector in its own rule instead, e.g. \`.day { &--today {} }\` -> \`.day--today {}\`
      loc: 6:16]
    `);
  });

  test('should throw for &- suffixes on the root selector', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'

          const style = css\`
            &-active { color: red; }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`&-active\` is not supported, CSS nesting can't concatenate a suffix to the generated class name, use a separate class instead, e.g. \`&-active {}\` -> \`&.active {}\`
      loc: 4:2]
    `);
  });

  test('should throw for suffixes from interpolated values', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { css } from 'vindur'

          const SUFFIX = '--today'

          const style = css\`
            .day { &\${SUFFIX} { color: red; } }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`&--today\` is not supported, CSS nesting can't concatenate a suffix to the parent selector, write the full selector in its own rule instead, e.g. \`.day { &--today {} }\` -> \`.day--today {}\`
      loc: 6:9]
    `);
  });

  test('should throw for & followed by an element name', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Card = styled.div\`
            &input { color: red; }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`&input\` is ambiguous, Sass concatenates it to the parent selector but CSS nesting reads it as an element selector, write \`input&\` to match \`input\` elements or the full selector for a suffix
      loc: 4:2]
    `);
  });

  test('should allow & followed by other selectors and & in values', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          --x: a&b;
          content: "&--x";
          &.active, &:hover, &[data-x], && { color: red; }
          & > .title, & .body, div& { color: blue; }
        \`
      `,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        --x: a&b;
        content: "&--x";
        &.active,
        &:hover,
        &[data-x],
        && {
          color: red;
        }
        & > .title,
        & .body,
        div& {
          color: blue;
        }
      }
      "
    `);
  });
});
