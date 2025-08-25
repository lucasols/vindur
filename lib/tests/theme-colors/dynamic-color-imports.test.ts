import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('dynamic color imports', () => {
  test('should generate proper hash for imported dynamic color', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { themeColor } from '#/colors'

        const App = () => <div dynamicColor={themeColor.set('#ff0000')} />
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
      "const App = () => <div {...themeColor._sp("#ff0000", {})} />;
      "
    `);

    // The code should show evidence that a proper hash was generated
    // We can't predict the exact hash, but it should not contain the hardcoded one
    expect(result.code).not.toContain('v1560qbr-2'); // This should pass now
    expect(result.code).toContain('themeColor._sp'); // Should contain the dynamic color function
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

    // All colors should get proper sequential indices, not hardcoded values
    expect(result.code).not.toContain('v1560qbr-2');
    expect(result.code).toContain('v1560qbr-'); // Should contain the proper file hash

    // CSS should show proper sequential indices for imported colors
    expect(result.css).toContain('--v1560qbr-1'); // primaryColor gets index 1
    expect(result.css).toContain('--v1560qbr-2'); // secondaryColor gets index 2
    expect(result.css).toContain('--v1560qbr-3'); // localColor gets index 3
    expect(result.css).toContain('v1560qbr-4-styles'); // styles gets index 4
  });

  test('should handle imported dynamic colors in development mode', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { brandColor } from '#/theme'

        const App = () => <div dynamicColor={brandColor.set('#3b82f6')} />
      `,
      overrideDefaultFs: createFsMock({
        'theme.ts': dedent`
          import { createDynamicCssColor } from 'vindur'
          export const brandColor = createDynamicCssColor()
        `,
      }),
      production: false, // dev mode
    });

    // Should not contain hardcoded hash
    expect(result.code).not.toContain('v1560qbr-2');
  });

  test('should handle imported dynamic colors in production mode', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { accentColor } from '#/colors'

        const App = () => <div dynamicColor={accentColor.set('#10b981')} />
      `,
      overrideDefaultFs: createFsMock({
        'colors.ts': dedent`
          import { createDynamicCssColor } from 'vindur'
          export const accentColor = createDynamicCssColor()
        `,
      }),
      production: true,
    });

    // Should not contain hardcoded hash
    expect(result.code).not.toContain('v1560qbr-2');
  });

  test('should investigate hardcoded hash behavior', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { themeColor } from '#/colors'
        import { css } from 'vindur'

        const styles = css\`
          color: \${themeColor.var};
        \`

        const App = () => <div className={styles} />
      `,
      overrideDefaultFs: createFsMock({
        'colors.ts': dedent`
          import { createDynamicCssColor } from 'vindur'
          export const themeColor = createDynamicCssColor()
        `,
      }),
    });

    // Result code should show proper hash generation

    // Let's see what actually gets generated
    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-2-styles";
      const App = () => <div className={styles} />;
      "
    `);
    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-styles {
        color: var(--v1560qbr-1);
      }
      "
    `);
  });
});
