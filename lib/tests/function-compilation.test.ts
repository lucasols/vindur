import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transform } from '../src/transform';
import { createFsMock } from './testUtils';

describe('function compilation', () => {
  // Currently, compilation-time features are not implemented yet
  // These tests would be for features like:
  // - Variable references from the same file
  // - Import resolution
  // - Complex expressions that should be evaluated at compile time
  // - Cross-file dependencies
  
  // For now, this file is a placeholder for future compilation-time features
  test.todo('function with compile-time variable resolution');
  test.todo('function with imported constants');
  test.todo('function with cross-file dependencies');
  test.todo('function with complex compile-time expressions');
});