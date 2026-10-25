import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should throw for an unclosed comment', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          color: red;
          /* width: 1px;
          background: blue;
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: unclosed comment, add \`*/\`
    loc: 5:2]
  `);
});

test('should throw for an unclosed comment from an interpolated value', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const comment = '/* note'

        const style = css\`
          color: red;
          \${comment}
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: unclosed comment, add \`*/\` (found in the interpolated value)
    loc: 7:4]
  `);
});

test('should throw for an unclosed parenthesis in a nested rule', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          &:hover {
            width: calc(100% - 2px;
          }
          color: red;
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: unclosed \`(\`, add \`)\`
    loc: 5:15]
  `);
});

test('should throw for an unclosed bracket in a media rule', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          @media (min-width: 1px) {
            grid-template-columns: [a 1fr;
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: unclosed \`[\`, add \`]\`
    loc: 5:27]
  `);
});

test('should throw for an unclosed url in a nested rule', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          &:hover {
            background: url(a.png;
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: unclosed \`url(\`, add \`)\`
    loc: 5:16]
  `);
});

test('should throw for an unexpected closing parenthesis', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          &:hover {
            width: 1px);
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: unexpected \`)\`
    loc: 5:14]
  `);
});

test('should accept brackets inside strings, comments and quoted urls', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'

      const style = css\`
        /* ( [ { */
        &::before {
          content: "( [";
          background: url("a(.png");
          mask: url(b.svg);
        }
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      /* ( [ { */
      &::before {
        content: "( [";
        background: url("a(.png");
        mask: url(b.svg);
      }
    }
    "
  `);
});

test('should throw for an unclosed string', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          &::before { content: "a; }
          color: red;
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: unclosed string, add \`"\`
    loc: 4:23]
  `);
});
