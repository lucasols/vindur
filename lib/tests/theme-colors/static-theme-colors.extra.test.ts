import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('createStaticThemeColors', () => {
  describe('minified color output', () => {
    test('should output minified hex colors for alpha values', async () => {
      const source = dedent`
        import { createStaticThemeColors, styled } from 'vindur'

        const colors = createStaticThemeColors({
          white: '#ffffff',
          black: '#000000',
          red: '#ff0000',
        })

        const Component = styled.div\`
          background: \${colors.white.alpha(0.2)};
          border: 1px solid \${colors.red.alpha(0.5)};
          color: \${colors.black.alpha(0.8)};
          box-shadow: 0 2px 4px \${colors.white.alpha(0.1)};
        \`
      `;

      const result = await transformWithFormat({ source });

      expect(result.code).toMatchInlineSnapshot(`
        "import { createStaticThemeColors } from "vindur";
        const colors = createStaticThemeColors({
          white: "#ffffff",
          black: "#000000",
          red: "#ff0000",
        });
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Component {
          background: var(--stc-white-alpha-0\\.2, #fff3);
          border: 1px solid var(--stc-red-alpha-0\\.5, #ff000080);
          color: var(--stc-black-alpha-0\\.8, #000c);
          box-shadow: 0 2px 4px var(--stc-white-alpha-0\\.1, #ffffff1a);
        }
        "
      `);
    });

    test('should output minified 3-character hex codes for .var properties', async () => {
      const source = dedent`
        import { createStaticThemeColors, styled } from 'vindur'

        const colors = createStaticThemeColors({
          red: '#ff0000',
          green: '#00ff00',
          blue: '#0000ff',
          white: '#ffffff',
          black: '#000000',
        })

        const Component = styled.div\`
          color: \${colors.red.var};
          background: \${colors.green.var};
          border-color: \${colors.blue.var};
          outline-color: \${colors.white.var};
          text-shadow: 1px 1px \${colors.black.var};
        \`
      `;

      const result = await transformWithFormat({ source });

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Component {
          color: var(--stc-red-var, #f00);
          background: var(--stc-green-var, #0f0);
          border-color: var(--stc-blue-var, #00f);
          outline-color: var(--stc-white-var, #fff);
          text-shadow: 1px 1px var(--stc-black-var, #000);
        }
        "
      `);
    });

    test('should minify contrast colors', async () => {
      const source = dedent`
        import { createStaticThemeColors, styled } from 'vindur'

        const colors = createStaticThemeColors({
          primary: '#007bff',
          light: '#ffffff',
        })

        const Component = styled.div\`
          color: \${colors.primary.contrast.var};
          background: \${colors.light.contrast.var};
          border: 1px solid \${colors.primary.contrast.alpha(0.2)};
        \`
      `;

      const result = await transformWithFormat({ source });

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Component {
          color: var(--stc-primary-contrast-var, #fff);
          background: var(--stc-light-contrast-var, #000);
          border: 1px solid var(--stc-primary-contrast-alpha-0\\.2, #fff3);
        }
        "
      `);
    });

    test('should minify darker and lighter colors', async () => {
      const source = dedent`
        import { createStaticThemeColors, styled } from 'vindur'

        const colors = createStaticThemeColors({
          primary: '#007bff',
          secondary: '#ff0000',
        })

        const Component = styled.div\`
          background: \${colors.primary.darker(0.1)};
          color: \${colors.secondary.lighter(0.2)};
        \`
      `;

      const result = await transformWithFormat({ source });

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1-Component {
          background: var(--stc-primary-darker-0\\.1, #006fe6);
          color: var(--stc-secondary-lighter-0\\.2, #f33);
        }
        "
      `);
    });
  });

  describe('validation', () => {
    test('should validate that theme colors are valid hex colors without alpha (named color)', async () => {
      const source = dedent`
        import { createStaticThemeColors } from 'vindur'

        const colors = createStaticThemeColors({
          invalid: 'red',
        })
      `;

      await expect(transformWithFormat({ source })).rejects
        .toMatchInlineSnapshot(`
        [TransformError: /test.tsx: Invalid color "red" for "invalid". Theme colors must be valid hex colors without alpha (e.g., "#ff0000" or "#f00")
        loc: 4:11]
      `);
    });

    test('should validate that theme colors are valid hex colors without alpha (hex with alpha)', async () => {
      const source = dedent`
        import { createStaticThemeColors } from 'vindur'

        const colors = createStaticThemeColors({
          invalid: '#ff000080',
        })
      `;

      await expect(transformWithFormat({ source })).rejects
        .toMatchInlineSnapshot(`
        [TransformError: /test.tsx: Invalid color "#ff000080" for "invalid". Theme colors must be valid hex colors without alpha (e.g., "#ff0000" or "#f00")
        loc: 4:11]
      `);
    });

    test('should accept valid hex colors', async () => {
      const validColorCases = [
        '#ff0000',
        '#FF0000',
        '#f00',
        '#F00',
        '#123456',
        '#abc',
      ];

      for (const color of validColorCases) {
        const source = dedent`
          import { createStaticThemeColors } from 'vindur'

          const colors = createStaticThemeColors({
            valid: '${color}',
          })
        `;

        // Should not throw
        await expect(transformWithFormat({ source })).resolves.toBeDefined();
      }
    });
  });
});

test('should evaluate constant and negative amounts of static theme color methods', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, createStaticThemeColors } from 'vindur';

      const colors = createStaticThemeColors({ primary: '#007bff' });
      const AMOUNT = 0.2;
      const OPTIONS = { alpha: 0.5 };

      export const style = css\`
        color: \${colors.primary.darker(AMOUNT)};
        background: \${colors.primary.lighter(-0.1)};
        border-color: \${colors.primary.contrast.optimal(OPTIONS)};
        outline-color: \${colors.primary.contrast.optimal({ alpha: 0 })};
      \`;
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      color: var(--stc-primary-darker-0\\.2, #0062cc);
      background: var(--stc-primary-lighter--0\\.1, #006eff);
      border-color: var(--stc-primary-contrast-optimal-0\\.5, #ffffff80);
      outline-color: var(--stc-primary-contrast-optimal-0, #fff0);
    }
    "
  `);
});

test('should fail on static theme color method amounts that are not static', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, createStaticThemeColors } from 'vindur';

        const colors = createStaticThemeColors({ primary: '#007bff' });

        export const style = css\`
          color: \${colors.primary.darker(getAmount())};
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Method darker requires a numeric argument
    loc: 6:11]
  `);
});

test('should treat an undefined optimal contrast option as omitted', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, createStaticThemeColors, createDynamicCssColor } from 'vindur';

      const colors = createStaticThemeColors({ light: '#f7fafc' });
      const color = createDynamicCssColor();

      export const styles = css\`
        color: \${colors.light.contrast.optimal(undefined)};
        border-color: \${colors.light.contrast.optimal({ alpha: undefined })};
        background: \${color.contrast.optimal(undefined)};
        outline-color: \${color.contrast.optimal({ alpha: undefined })};
      \`;
    `,
    production: true,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2 {
      color: #002a46;
      border-color: #002a46;
      background: var(--v1560qbr-1-c-optimal);
      outline-color: var(--v1560qbr-1-c-optimal);
    }
    "
  `);
});

test('should evaluate constant amounts of dynamic color methods', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, createDynamicCssColor } from 'vindur';

      const AMOUNT = 0.2;
      const color = createDynamicCssColor();

      export const styles = css\`
        color: \${color.saturatedDarker(AMOUNT)};
        background: \${color.darker(AMOUNT)};
        border-color: \${color.alpha(AMOUNT)};
      \`;
    `,
    production: true,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2 {
      color: hsl(
        var(--v1560qbr-1-h),
        var(--v1560qbr-1-sds),
        calc(var(--v1560qbr-1-l) * 0.8)
      );
      background: color-mix(in srgb, var(--v1560qbr-1) 80%, #000);
      border-color: color-mix(in srgb, var(--v1560qbr-1) 20%, transparent);
    }
    "
  `);
});

test('should throw error when a theme color method is called without amount', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createStaticThemeColors, css } from 'vindur'

        const colors = createStaticThemeColors({ primary: '#007bff' })

        const style = css\`
          color: \${colors.primary.contrast.darker()};
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Method darker requires a numeric argument
    loc: 6:11]
  `);
});

test('should interpolate defaultHex of static theme colors as written', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createStaticThemeColors, css } from 'vindur'

      const colors = createStaticThemeColors({
        primary: '#FF0000',
      })

      const styles = css\`
        content: "\${colors.primary.defaultHex}";
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-styles {
      content: "#FF0000";
    }
    "
  `);
});
