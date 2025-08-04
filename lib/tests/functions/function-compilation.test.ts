import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

test('compile file with exported function', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { spacing } from '@/utils'

      // Just test that importing vindurFn functions works
      console.log('Spacing function imported successfully')
    `,
    overrideDefaultFs: {
      readFile: (path: string) => {
        if (path === '/utils.ts') {
          return dedent`
            import { vindurFn } from 'vindur'
            export const spacing = vindurFn((size: number) => \`\${size}px\`)
          `;
        }
        throw new Error(`File not found: ${path}`);
      },
    },
    overrideDefaultImportAliases: {
      '@/': '/',
    },
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { spacing } from "@/utils";

    // Just test that importing vindurFn functions works
    console.log("Spacing function imported successfully");
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`""`);
});

test('compile file with vindurFn function and css exports', async () => {
  const fnFile = dedent`
    import { vindurFn, css } from 'vindur'

    export const spacing = vindurFn((size: number) => \`\${size}px\`)

    export const spacingCss = css\`
      margin: 16px;
    \`
  `;

  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { spacingCss } from '#/utils'

      const style = css\`
        \${spacingCss};
      \`
    `,
    overrideDefaultFs: createFsMock({ 'utils.ts': fnFile }),
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1i9guam-1 {
      margin: 16px;
    }
    "
  `);

  expect(result.code).toMatchInlineSnapshot(`
    "const style = "v1i9guam-1 v1560qbr-1-style";
    "
  `);
});
