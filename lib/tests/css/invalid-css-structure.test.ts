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
    [TransformError: /test.tsx: Invalid CSS at \`... fade = keyframes\`: keyframes templates can only contain keyframe blocks, e.g. \`from { ... } to { ... }\`
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
