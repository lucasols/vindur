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
