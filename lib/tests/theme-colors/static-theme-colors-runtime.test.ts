import { describe, expect, test } from 'vitest';
import { createStaticThemeColors } from '../../src/main';

describe('createStaticThemeColors runtime', () => {
  test('provides runtime color operations using hex', () => {
    const colors = createStaticThemeColors({
      primary: '#007bff',
      light: '#ffffff',
      dark: '#000000',
      red: '#ff0000',
    });

    expect(colors.primary.defaultHex).toBe('#007bff');
    expect(colors.primary.var).toBe('#007bff');
    expect(colors.red.alpha(0.5)).toBe(
      'color-mix(in srgb, #ff0000 50%, transparent)'
    );
    expect(colors.primary.darker(0.1)).toBe(
      'color-mix(in srgb, #007bff 90%, #000)'
    );
    expect(colors.primary.lighter(0.3)).toBe(
      'color-mix(in srgb, #007bff 70%, #fff)'
    );
    expect(colors.primary.saturatedDarker(0.1)).toBe(
      'color-mix(in srgb, #007bff 90%, hsl(from #007bff h 100% 20%))'
    );

    // Contrast operations
    expect(colors.primary.contrast.var).toBe('#ffffff');
    expect(colors.primary.contrast.alpha(0.8)).toBe(
      'color-mix(in srgb, #ffffff 80%, transparent)'
    );
    expect(colors.light.contrast.var).toBe('#000000');
    expect(colors.primary.contrast.optimal()).toBe('#ffffff');
    expect(colors.primary.contrast.optimal({ alpha: 0.6 })).toBe(
      'color-mix(in srgb, #ffffff 60%, transparent)'
    );
  });
});
