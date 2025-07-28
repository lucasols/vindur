import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

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
