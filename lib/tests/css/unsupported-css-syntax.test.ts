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
      [TransformError: /test.tsx: \`:global\` is not supported, plain class selectors are not hashed so remove the wrapper, e.g. \`:global(.dark) &\` -> \`.dark &\`
      loc: 6:2]
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
      [TransformError: /test.tsx: \`:global\` is not supported, plain class selectors are not hashed so remove the wrapper, e.g. \`:global(.dark) &\` -> \`.dark &\`
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
});
