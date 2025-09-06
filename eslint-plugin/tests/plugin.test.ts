import { describe, expect, test } from 'vitest';
import { vindurPlugin } from '../src/index';

describe('vindur eslint plugin structure', () => {
  test('should export plugin with correct metadata', () => {
    expect(vindurPlugin.meta).toEqual({
      name: '@vindur/eslint-plugin',
      version: '0.1.0',
    });
  });

  test('should have check-transform rule', () => {
    expect(vindurPlugin.rules['check-transform']).toBeDefined();
    expect(vindurPlugin.rules['check-transform'].meta).toBeDefined();
    expect(vindurPlugin.rules['check-transform'].meta.type).toBe('problem');
    expect(vindurPlugin.rules['check-transform'].meta.docs?.description).toBe('Detect Vindur transform errors and warnings');
    
    const createFn = vindurPlugin.rules['check-transform'].create;
    expect(createFn).toBeTypeOf('function');
  });

  test('should export recommended config', () => {
    const recommended = vindurPlugin.configs.recommended;
    expect(recommended).toBeDefined();
    
    if (!recommended) throw new Error('Recommended config should exist');
    expect(recommended.rules['@vindur/check-transform']).toBe('error');
    expect(recommended.plugins['@vindur']).toBe(vindurPlugin);
  });

  test('should have proper rule schema', () => {
    const rule = vindurPlugin.rules['check-transform'];
    expect(rule.meta.schema).toBeDefined();
    expect(Array.isArray(rule.meta.schema)).toBe(true);
    expect(rule.meta.schema[0]).toBeDefined();
    expect(rule.meta.schema[0].type).toBe('object');
  });

  test('should have proper message IDs', () => {
    const rule = vindurPlugin.rules['check-transform'];
    expect(rule.meta.messages).toBeDefined();
    expect(rule.meta.messages.transformError).toBe('{{message}}');
    expect(rule.meta.messages.transformWarning).toBe('{{message}}');
  });
});