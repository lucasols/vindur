import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('createStaticThemeColors only import', () => {
  test('should preserve createStaticThemeColors import when imported alone', async () => {
    const source = dedent`
      import { createStaticThemeColors } from 'vindur'

      const colors = createStaticThemeColors({
        primary: '#007bff',
        secondary: '#6c757d',
      })

      // No other vindur functions used, just the theme colors
      console.log(colors.primary.var)
    `;

    const result = await transformWithFormat({ source });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createStaticThemeColors } from "vindur";
      const colors = createStaticThemeColors({
        primary: "#007bff",
        secondary: "#6c757d",
      });

      // No other vindur functions used, just the theme colors
      console.log(colors.primary.var);
      "
    `);
  });

  test('should work with createStaticThemeColors only in runtime context', async () => {
    const source = dedent`
      import { createStaticThemeColors } from 'vindur'

      const colors = createStaticThemeColors({
        primary: '#007bff',
        danger: '#dc3545',
      })

      export function getThemeColor(name: keyof typeof colors) {
        return colors[name].var
      }
    `;

    const result = await transformWithFormat({ source });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createStaticThemeColors } from "vindur";
      const colors = createStaticThemeColors({
        primary: "#007bff",
        danger: "#dc3545",
      });
      export function getThemeColor(name: keyof typeof colors) {
        return colors[name].var;
      }
      "
    `);
    // Should not generate any CSS since there are no css templates
    expect(result.css).toBe('');
  });
});