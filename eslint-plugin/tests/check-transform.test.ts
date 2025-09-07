/* eslint-disable vitest/expect-expect -- not needed */
import { dedent } from '@ls-stack/utils/dedent';
import {
  existsSync,
  readFileSync,
  type PathLike,
  type PathOrFileDescriptor,
} from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { checkTransformRule } from '../src/rules/check-transform';
import {
  createVindurTester,
  getErrorsWithMsgFromResult,
} from './utils/createTester';

// Mock fs functions
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

const { valid, invalid } = createVindurTester({
  name: 'check-transform',
  rule: checkTransformRule,
});

const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.clearAllMocks();
  // Default mock behavior - files don't exist
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockImplementation((path) => {
    throw new Error(`File not found: ${String(path)}`);
  });
});

describe('valid cases - no errors', () => {
  test('regular JavaScript without vindur', async () => {
    await valid(dedent`
      const regularCode = 'hello world';
      console.log(regularCode);
    `);
  });

  test('valid vindur css usage', async () => {
    await valid(
      dedent`
        import { css } from 'vindur';
        const styles = css\`
          color: red;
          background: blue;
        \`;
      `,
    );
  });

  test('valid styled component usage', async () => {
    await valid(
      dedent`
        import { styled } from 'vindur';
        const Button = styled.button\`
          color: white;
          background: blue;
        \`;
      `,
    );
  });
});

describe('invalid cases - should report transform errors', () => {
  test('undefined variable in css template', async () => {
    const { result } = await invalid(
      dedent`
        import { css } from 'vindur';
        const styles = css\`
          color: \${undefinedVariable};
        \`;
      `,
    );

    expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
      [
        {
          "line": 3,
          "messageId": "transformError",
          "msg": "/test.ts: Invalid interpolation used at \`... styles = css\` ... \${undefinedVariable}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported",
        },
      ]
    `);
  });

});

describe('rule options', () => {
  test('dev mode disabled', async () => {
    await valid({
      code: dedent`

        import { css } from 'vindur';
        const styles = css\`color: red;\`;
      `,
      options: [{ dev: false }],
    });
  });

  test('import aliases support', async () => {
    const { result } = await invalid({
      code: dedent`
        import { css } from '@/vindur';
        const styles = css\`color: red;\`;
      `,
      options: [
        {
          importAliases: { '@': './src' },
        },
      ],
    });

    expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
      [
        {
          "line": 1,
          "messageId": "transformError",
          "msg": "/test.ts: File not found: ./src/vindur.ts",
        },
      ]
    `);
  });

  test('warnings disabled', async () => {
    await valid({
      code: dedent`
        import { css } from 'vindur';
        const styles = css\`color: red;\`;
      `,
      options: [{ reportWarnings: false }],
    });
  });
});

describe('additional features', () => {
  test('keyframes usage', async () => {
    await valid(
      dedent`
        import { keyframes } from 'vindur';
        const fadeIn = keyframes\`
          from { opacity: 0; }
          to { opacity: 1; }
        \`;
      `,
    );
  });
});

describe('file system mocking scenarios', () => {
  test('import aliases with existing file', async () => {
    // Mock file system to simulate existing file
    mockExistsSync.mockImplementation((path) => {
      return path === '/src/vindur.ts';
    });
    mockReadFileSync.mockImplementation((path) => {
      if (path === '/src/vindur.ts') {
        return `
          export const css = () => 'mocked-css-function';
          export const styled = () => 'mocked-styled-function';
        `;
      }
      throw new Error(`File not found: ${String(path)}`);
    });

    await valid({
      code: dedent`
        import { css } from '@/vindur';
        const styles = css\`color: red;\`;
      `,
      options: [
        {
          importAliases: { '@': '/src' },
        },
      ],
    });
  });

  test('import aliases with non-existing file', async () => {
    await valid({
      code: dedent`
        import { css } from '@/vindur';
        const styles = css\`color: red;\`;
      `,
      options: [
        {
          importAliases: { '@': '/src' },
        },
      ],
    });
  });

});
