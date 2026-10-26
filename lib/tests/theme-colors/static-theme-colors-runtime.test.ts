import { describe, expect, test } from 'vitest';
import { createStaticThemeColors } from '../../src/main';
import { transform } from '../../src/transform';

describe('createStaticThemeColors runtime', () => {
  test('provides runtime color operations matching the compiled output', () => {
    const colors = createStaticThemeColors({
      primary: '#007bff',
      light: '#ffffff',
      dark: '#000000',
      red: '#ff0000',
    });

    expect(colors.primary.defaultHex).toBe('#007bff');
    expect(colors.primary.var).toBe('#007bff');
    // values match the compiled production output
    expect(colors.red.alpha(0.5)).toBe('#ff000080');
    expect(colors.primary.darker(0.1)).toBe('#006fe6');
    expect(colors.primary.lighter(0.3)).toBe('#4da3ff');
    expect(colors.primary.saturatedDarker(0.1)).toBe('#006fe6');

    // Contrast operations
    expect(colors.primary.contrast.var).toBe('#fff');
    expect(colors.primary.contrast.alpha(0.8)).toBe('#fffc');
    expect(colors.light.contrast.var).toBe('#000');
    expect(colors.primary.contrast.optimal()).toBe('#fff');
    expect(colors.primary.contrast.optimal({ alpha: 0.6 })).toBe('#fff9');
    expect(colors.light.contrast.optimal()).toBe('#242424');
  });
});

test('runtime color operations match the compiled production output', () => {
  const palette = {
    primary: '#007bff',
    newPrimary: '#6464f6',
    success: '#16a34a',
    gray: '#808080',
    nearGray: '#9a9c9f',
    light: '#f1f5f9',
    dark: '#1e293b',
    white: '#ffffff',
    black: '#000000',
    // float noise in the hue math changed the runtime value
    olive: '#907d1e',
  };
  const operations = [
    'darker(0.2)',
    'lighter(0.35)',
    'saturatedDarker(0.3)',
    'saturatedDarker(0.5)',
    'alpha(0.4)',
    'alpha(0)',
    'contrast.var',
    'contrast.alpha(0.5)',
    'contrast.optimal()',
    'contrast.optimal({ alpha: 0 })',
    'contrast.optimal({ alpha: AMOUNT })',
  ];
  const colors = createStaticThemeColors(palette);
  const runtimeValues = Object.values(colors).flatMap((color) => {
    return [
      color.darker(0.2),
      color.lighter(0.35),
      color.saturatedDarker(0.3),
      color.saturatedDarker(0.5),
      color.alpha(0.4),
      color.alpha(0),
      color.contrast.var,
      color.contrast.alpha(0.5),
      color.contrast.optimal(),
      color.contrast.optimal({ alpha: 0 }),
      color.contrast.optimal({ alpha: 0.3 }),
    ];
  });

  const declarations = Object.keys(palette).flatMap((name) =>
    operations.map((operation) => `--v: \${colors.${name}.${operation}};`),
  );
  const { css } = transform({
    fileAbsPath: '/test.ts',
    source: `
      import { createStaticThemeColors, css } from 'vindur'
      const colors = createStaticThemeColors(${JSON.stringify(palette)})
      const AMOUNT = 0.3
      export const style = css\`${declarations.join('\n')}\`
    `,
    fs: { readFile: () => '', exists: () => false },
    importAliases: {},
    transformFunctionCache: {},
    transformDynamicColorCache: {},
    dev: false,
  });
  const compiledValues = [...css.matchAll(/--v: ([^;]+);/g)].map(
    (match) => match[1],
  );

  expect(compiledValues).toEqual(runtimeValues);
});
