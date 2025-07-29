import { describe, expect, test, vi } from 'vitest';
import {
  _vSC,
  _vCWM,
  createDynamicCssColor,
  cx,
  mergeClassNames,
  mergeStyles,
  createClassName,
} from '../../src/main';

describe('_vSC', () => {
  test('should create component with correct displayName', () => {
    const Component = _vSC('div', 'test-class');
    expect(Component.displayName).toBe('Styled(div)');
  });

  test('should handle custom component with displayName', () => {
    const CustomComponent = () => null;
    CustomComponent.displayName = 'CustomComponent';
    
    const StyledCustom = _vSC(CustomComponent, 'styled-class');
    expect(StyledCustom.displayName).toBe('Styled(CustomComponent)');
  });

  test('should handle custom component without displayName', () => {
    const CustomComponent = () => null;
    const StyledCustom = _vSC(CustomComponent, 'styled-class');
    expect(StyledCustom.displayName).toBe('Styled(CustomComponent)');
  });

  test('should handle anonymous component', () => {
    const StyledAnon = _vSC(() => null, 'styled-class');
    expect(StyledAnon.displayName).toBe('Styled(Component)');
  });
});

describe('_vCWM', () => {
  test('should create component with correct displayName', () => {
    const modifiers: Array<[string, string]> = [['active', 'active-class']];
    const Component = _vCWM(modifiers, 'base-class', 'button');
    
    expect(Component.displayName).toBe('StyledWithModifiers(button)');
  });
});

describe('createDynamicCssColor', () => {
  test('should throw error without hashId', () => {
    expect(() => createDynamicCssColor()).toThrow(
      'createDynamicCssColor() cannot be called at runtime without compiler transformation'
    );
  });

  test('should create color object with proper methods in dev mode', () => {
    const color = createDynamicCssColor('test-hash', true);
    
    expect(color.var).toBe('var(--test-hash)');
    expect(color.alpha(0.5)).toBe('color-mix(in srgb, var(--test-hash) 50%, transparent)');
    expect(color.darker(0.2)).toBe('color-mix(in srgb, var(--test-hash) 80%, #000)');
    expect(color.lighter(0.3)).toBe('color-mix(in srgb, var(--test-hash) 70%, #fff)');
    expect(color.saturatedDarker(0.4)).toBe('color-mix(in srgb, var(--test-hash) 60%, hsl(from var(--test-hash) h 100% 20%))');
    
    expect(color.contrast.var).toBe('var(--test-hash-c)');
    expect(color.contrast.optimal()).toBe('var(--test-hash-c-optimal)');
    expect(color.contrast.optimal({ alpha: 0.8 })).toBe('color-mix(in srgb, var(--test-hash-c-optimal) 80%, transparent)');
    expect(color.contrast.alpha(0.6)).toBe('color-mix(in srgb, var(--test-hash-c) 60%, transparent)');
  });

  test('should generate dev-mode class names', () => {
    const color = createDynamicCssColor('test-hash', true);
    
    expect(color.self.isDark).toBe('&.test-hash-self-is-dark');
    expect(color.self.isLight).toBe('&.test-hash-self-is-light');
    expect(color.container.isDefined).toBe('.test-hash-container-is-defined &');
    expect(color.container.isNotDefined).toBe('.test-hash-container-is-not-defined &');
  });

  test('should generate production class names', () => {
    const color = createDynamicCssColor('test-hash', false);
    
    expect(color.self.isDark).toBe('&.test-hash-s0');
    expect(color.self.isLight).toBe('&.test-hash-s1');
    expect(color.container.isDefined).toBe('.test-hash-c2 &');
    expect(color.container.isNotDefined).toBe('.test-hash-c3 &');
  });

  test('should handle setProps for light colors', () => {
    const color = createDynamicCssColor('test-hash', true);
    const result = color.setProps('#ffffff', { className: 'user-class' });
    
    expect(result.className).toContain('user-class');
    expect(result.className).toContain('test-hash-self-is-light');
    expect(result.className).toContain('test-hash-self-is-defined');
    expect(result.className).toContain('test-hash-self-is-not-very-dark');
    expect(result.className).toContain('test-hash-self-is-very-light');
    
    expect(result.style).toEqual({
      '--test-hash': '#ffffff',
      '--test-hash-c': '#000000',
      '--test-hash-c-optimal': '#000000'
    });
  });

  test('should handle setProps for dark colors', () => {
    const color = createDynamicCssColor('test-hash', true);
    const result = color.setProps('#000000');
    
    expect(result.className).toContain('test-hash-self-is-dark');
    expect(result.className).toContain('test-hash-self-is-defined');
    expect(result.className).toContain('test-hash-self-is-very-dark');
    expect(result.className).toContain('test-hash-self-is-not-very-light');
    
    expect(result.style).toEqual({
      '--test-hash': '#000000',
      '--test-hash-c': '#ffffff',
      '--test-hash-c-optimal': '#ffffff'
    });
  });

  test('should handle _sp method with null color', () => {
    const color = createDynamicCssColor('test-hash', true);
    const result = color._sp(null, { className: 'base', style: { margin: '10px' } });
    
    expect(result).toEqual({ className: 'base', style: { margin: '10px' } });
  });

  test('should handle _sp method with valid color', () => {
    const color = createDynamicCssColor('test-hash', true);
    const result = color._sp('#ff0000', { className: 'base', style: { margin: '10px' } });
    
    expect(result.className).toContain('base');
    expect(result.className).toContain('test-hash-self-is-dark');
    expect(result.style).toEqual({
      margin: '10px',
      '--test-hash': '#ff0000',
      '--test-hash-c': '#ffffff',
      '--test-hash-c-optimal': '#ffffff'
    });
  });

  test('should handle set method with warning', () => {
    const color = createDynamicCssColor('test-hash', true);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    const result = color.set('#123456');
    
    expect(consoleSpy).toHaveBeenCalledWith('color.set() should not be called at runtime');
    expect(result).toEqual({
      __color: '#123456',
      __dynamicColorId: 'test-hash'
    });
    
    consoleSpy.mockRestore();
  });
});

describe('cx', () => {
  test('should join string arguments', () => {
    expect(cx('class1', 'class2', 'class3')).toBe('class1 class2 class3');
  });

  test('should handle object arguments', () => {
    expect(cx({ active: true, disabled: false, loading: true })).toBe('active loading');
  });

  test('should mix strings and objects', () => {
    expect(cx('base', { active: true, disabled: false }, 'extra')).toBe('base active extra');
  });

  test('should filter out falsy values', () => {
    expect(cx('class1', null, false, undefined, '', 'class2')).toBe('class1 class2');
  });

  test('should handle empty input', () => {
    expect(cx()).toBe('');
  });

  test('should handle number values', () => {
    // @ts-expect-error Testing runtime behavior with number (normally not allowed by types)
    expect(cx('class1', 42, 'class2')).toBe('class1 42 class2');
  });

  test('should handle nested objects', () => {
    expect(cx({
      'class1': true,
      'class2': false,
      'class3': 1,
      'class4': 0,
      'class5': 'truthy'
    })).toBe('class1 class3 class5');
  });
});

describe('mergeClassNames', () => {
  test('should merge string props with vindur className', () => {
    const result = mergeClassNames(['user-class'], 'vindur-class');
    expect(result).toBe('user-class vindur-class');
  });

  test('should merge object props with className property', () => {
    const result = mergeClassNames([{ className: 'obj-class' }], 'vindur-class');
    expect(result).toBe('obj-class vindur-class');
  });

  test('should handle mixed props', () => {
    const result = mergeClassNames([
      'string-class',
      { className: 'obj-class' },
      { otherProp: 'value' },
      'another-string'
    ], 'vindur-class');
    expect(result).toBe('string-class obj-class another-string vindur-class');
  });

  test('should handle empty spread props', () => {
    const result = mergeClassNames([], 'vindur-class');
    expect(result).toBe('vindur-class');
  });

  test('should ignore non-string className properties', () => {
    const result = mergeClassNames([
      { className: 123 },
      { className: null },
      { className: 'valid-class' }
    ], 'vindur-class');
    expect(result).toBe('valid-class vindur-class');
  });
});

describe('mergeStyles', () => {
  test('should merge style objects from spread props', () => {
    const result = mergeStyles([
      { style: { color: 'red', margin: '10px' } },
      { style: { backgroundColor: 'blue', margin: '20px' } },
      { otherProp: 'value' }
    ]);
    
    expect(result).toEqual({
      color: 'red',
      margin: '20px', // Later value overwrites
      backgroundColor: 'blue'
    });
  });

  test('should handle empty props', () => {
    const result = mergeStyles([]);
    expect(result).toEqual({});
  });

  test('should ignore invalid style properties', () => {
    const result = mergeStyles([
      { style: 'invalid' },
      { style: null },
      { style: { color: 'red' } }
    ]);
    
    expect(result).toEqual({ color: 'red' });
  });

  test('should handle props without style property', () => {
    const result = mergeStyles([
      { className: 'test' },
      { id: 'test-id' }
    ]);
    
    expect(result).toEqual({});
  });
});

describe('createClassName', () => {
  test('should create className object with id', () => {
    const result = createClassName('test-class');
    
    expect(result).toEqual({
      selector: '.test-class',
      value: 'test-class'
    });
  });

  test('should throw error without id', () => {
    expect(() => createClassName()).toThrow('createClassName cannot be called at runtime');
  });
});