import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('dynamic color imports', () => {
  test('should generate proper hash for imported dynamic color', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { themeColor } from '#/colors'

        const styles = css\`
          color: \${themeColor.var};
        \`

        const App = () => <div className={styles} dynamicColor={themeColor.set('#ff0000')} />
      `,
      overrideDefaultFs: createFsMock({
        'colors.ts': dedent`
          import { createDynamicCssColor } from 'vindur'
          export const themeColor = createDynamicCssColor()
        `,
      }),
    });

    // The hash should follow the proper format: fileHash-index
    // Should NOT be the hardcoded 'v1560qbr-2'
    // For imported colors, they should get a proper index from the file where they're used
    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-1-styles";
      const App = () => <div className={styles} {...themeColor._sp("#ff0000", {})} />;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        color: var(--vip4ilp-1);
      }
      "
    `);
  });

  test('should generate sequential hash indices for multiple imported dynamic colors', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { primaryColor, secondaryColor } from '#/colors'
        import { createDynamicCssColor, css } from 'vindur'

        const localColor = createDynamicCssColor()

        const styles = css\`
          color: \${primaryColor.var};
          background: \${secondaryColor.var};  
          border: 1px solid \${localColor.var};
        \`
      `,
      overrideDefaultFs: createFsMock({
        'colors.ts': dedent`
          import { createDynamicCssColor } from 'vindur'
          export const primaryColor = createDynamicCssColor()
          export const secondaryColor = createDynamicCssColor()
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const localColor = createDynamicCssColor("v1560qbr-1", true);
      const styles = "v1560qbr-2-styles";
      "
    `);
    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-styles {
        color: var(--vip4ilp-1);
        background: var(--vip4ilp-2);
        border: 1px solid var(--v1560qbr-1);
      }
      "
    `);
  });

  test('should handle imported dynamic colors in production mode', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { brandColor } from '#/theme'

        const styles = css\`
          color: \${brandColor.var};
        \`

        const App = () => <div className={styles} dynamicColor={brandColor.set('#3b82f6')} />
      `,
      overrideDefaultFs: createFsMock({
        'theme.ts': dedent`
          import { createDynamicCssColor, css } from 'vindur'
          export const testCss = css\`
            color: test;
          \`
          export const brandColor = createDynamicCssColor()
        `,
      }),
      production: true, // dev mode
    });

    // Should not contain hardcoded hash
    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-1";
      const App = () => <div className={styles} {...brandColor._sp("#3b82f6", {})} />;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        color: var(--vckpm80-2);
      }
      "
    `);
  });
});
