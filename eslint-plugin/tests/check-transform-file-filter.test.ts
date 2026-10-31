import { dedent } from '@ls-stack/utils/dedent';
import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, expect, test, vi } from 'vitest';
import {
  checkTransformRule,
  clearTransformCaches,
} from '../src/rules/check-transform';
import {
  createVindurTester,
  getErrorsWithMsgFromResult,
} from './utils/createTester';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

const { valid, invalid } = createVindurTester({
  name: 'check-transform',
  rule: checkTransformRule,
});

const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.clearAllMocks();
  clearTransformCaches();
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockImplementation((path) => {
    throw new Error(`File not found: ${String(path)}`);
  });
});

test('should skip files of other CSS-in-JS libraries', async () => {
  await valid({
    code: dedent`
      import { styled } from '@linaria/react';
      import { field } from '@/field';

      export const Cell = styled.div\`
        color: red;
      \`;
    `,
    options: [{ importAliases: { '@': '/' } }],
  });

  // The file isn't compiled, so its imports aren't read either
  expect(mockReadFileSync).not.toHaveBeenCalled();
});

test('should check files that only use scoped variables', async () => {
  const { result } = await invalid(
    dedent`
      export const App = () => <div style={{ '---size': '8px' }} />;
    `,
  );

  expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
    "
    - messageId: 'transformError'
      msg: 'Scoped variable \`---size\` is not used by any style of this file, scoped variables only exist in the file whose styles use them'
      loc: '1:40'
    "
  `);
});

test('should check files with a comment before the vindur module name', async () => {
  const { result } = await invalid(
    dedent`
      import { styled } from /* styles */ 'vindur';

      export const Title = styled.div\`
        color: \${(props) => props.color};
      \`;
    `,
  );

  expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
    "
    - messageId: 'transformError'
      msg: 'Invalid arrow function in interpolation at \`... Title = styled\`. Only simple forward references like \${() => Component} are supported'
      loc: '4:12'
    "
  `);
});
