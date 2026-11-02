import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should throw for an ancestor selector nested in a pseudo-element rule', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const colorScheme = { container: { isDark: '.dm &' } }

        const Input = styled.input\`
          &::placeholder {
            color: gray;

            \${colorScheme.container.isDark} {
              color: white;
            }
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`.dm &\` can't be nested in a pseudo-element rule, \`&\` can't represent pseudo-elements so it would never match the pseudo-element. Write it as its own rule with the full selector, e.g. \`&::placeholder { .dark & {} }\` -> \`.dark &::placeholder {}\` or \`&::-webkit-scrollbar-thumb { &:hover {} }\` -> \`&::-webkit-scrollbar-thumb:hover {}\` (found in the interpolated value)
    loc: 9:6]
  `);
});

test('should throw for rules nested in legacy pseudo-elements and grouping rules', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          &:hover, &:After {
            @media (min-width: 600px) {
              &:focus { color: red; }
            }
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`&:focus\` can't be nested in a pseudo-element rule, \`&\` can't represent pseudo-elements so it would never match the pseudo-element. Write it as its own rule with the full selector, e.g. \`&::placeholder { .dark & {} }\` -> \`.dark &::placeholder {}\` or \`&::-webkit-scrollbar-thumb { &:hover {} }\` -> \`&::-webkit-scrollbar-thumb:hover {}\`
    loc: 6:6]
  `);
});

test('should throw for rules nested in pseudo-elements in createGlobalStyle', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          input::placeholder {
            span { color: red; }
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`span\` can't be nested in a pseudo-element rule, \`&\` can't represent pseudo-elements so it would never match the pseudo-element. Write it as its own rule with the full selector, e.g. \`&::placeholder { .dark & {} }\` -> \`.dark &::placeholder {}\` or \`&::-webkit-scrollbar-thumb { &:hover {} }\` -> \`&::-webkit-scrollbar-thumb:hover {}\`
    loc: 5:4]
  `);
});

test('should allow pseudo-elements at the end of nested selectors', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'

      const style = css\`
        &::placeholder {
          color: gray;

          @media (min-width: 600px) {
            color: black;
          }
        }

        .dm &::placeholder, a[href^='x::y'] > &:hover {
          color: white;
        }
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      &::placeholder {
        color: gray;

        @media (min-width: 600px) {
          color: black;
        }
      }

      .dm &::placeholder,
      a[href^="x::y"] > &:hover {
        color: white;
      }
    }
    "
  `);
});
