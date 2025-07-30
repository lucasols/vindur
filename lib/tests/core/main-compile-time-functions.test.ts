import { describe, expect, test } from 'vitest';
import {
  createGlobalStyle,
  createStaticThemeColors,
  css,
  keyframes,
  stableId,
  styled,
  vindurFn,
} from '../../src/main';

describe('compile-time functions should throw at runtime', () => {
  test('vindurFn should throw error at runtime', () => {
    const fn = (color: string) => `color: ${color}`;

    expect(() => vindurFn(fn)).toThrow('vindurFn cannot be called at runtime');
  });

  test('css should throw error at runtime', () => {
    expect(
      () => css`
        color: red;
      `,
    ).toThrow('css cannot be called at runtime');
  });

  test('createGlobalStyle should throw error at runtime', () => {
    expect(() => createGlobalStyle`body { margin: 0 }`).toThrow(
      'createGlobalStyle cannot be called at runtime',
    );
  });

  test('keyframes should throw error at runtime', () => {
    expect(() => keyframes`from { opacity: 0 } to { opacity: 1 }`).toThrow(
      'keyframes cannot be called at runtime',
    );
  });

  test('styled should throw error at runtime', () => {
    expect(
      () => styled.div`
        color: blue;
      `,
    ).toThrow('styled cannot be called at runtime');
  });

  test('styled with custom element should throw error at runtime', () => {
    expect(
      () => styled.button`
        background: red;
      `,
    ).toThrow('styled cannot be called at runtime');
  });

  test('createStaticThemeColors should return input at runtime', () => {
    const colors = {
      primary: '#007bff',
      secondary: '#6c757d',
    };

    // At runtime, it should return the input as-is (fallback behavior)
    const result = createStaticThemeColors(colors);
    expect(result).toBe(colors);
  });

  test('stableId should throw error at runtime', () => {
    expect(() => stableId()).toThrow('stableId cannot be called at runtime');
  });
});

describe('styled proxy behavior', () => {
  test('should handle dynamic property access', () => {
    // Test that styled proxy can handle any property access
    expect(
      () => styled.span`
        color: green;
      `,
    ).toThrow('styled cannot be called at runtime');
    expect(
      () => styled.article`
        padding: 10px;
      `,
    ).toThrow('styled cannot be called at runtime');
    expect(
      () => styled.section`
        margin: 5px;
      `,
    ).toThrow('styled cannot be called at runtime');
  });
});

describe('function signatures and types', () => {
  test('vindurFn should accept generic function types', () => {
    // These should compile without errors (testing type signatures)
    const stringFn = (text: string) => `content: "${text}"`;
    const numberFn = (size: number) => `font-size: ${size}px`;
    const multiFn = (color: string, size: number) =>
      `color: ${color}; font-size: ${size}px`;

    // All should throw at runtime but have correct types
    expect(() => vindurFn(stringFn)).toThrow();
    expect(() => vindurFn(numberFn)).toThrow();
    expect(() => vindurFn(multiFn)).toThrow();
  });

  test('css should accept template literal arguments', () => {
    const color = 'red';
    const size = 16;

    // Should throw but accept various interpolation types
    expect(
      () => css`
        color: ${color};
        font-size: ${size}px;
      `,
    ).toThrow();
  });

  test('createStaticThemeColors should preserve type structure', () => {
    const colors = {
      primary: '#007bff',
      secondary: '#6c757d',
      success: '#28a745',
    };

    const result = createStaticThemeColors(colors);

    // At runtime, keys should match input
    expect(Object.keys(result)).toEqual(['primary', 'secondary', 'success']);
    expect(result.primary).toBe('#007bff');
    expect(result.secondary).toBe('#6c757d');
    expect(result.success).toBe('#28a745');
  });
});
