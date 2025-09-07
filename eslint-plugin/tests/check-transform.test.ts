/* eslint-disable vitest/expect-expect -- not needed */
import { dedent } from '@ls-stack/utils/dedent';
import { existsSync, readFileSync } from 'node:fs';
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

describe('cross-file import behaviors', () => {
  test('vindurFn imported from another file', async () => {
    // Mock external file with vindurFn
    mockExistsSync.mockImplementation((path) => {
      return path === '/src/utils/styles.ts';
    });
    mockReadFileSync.mockImplementation((path) => {
      if (path === '/src/utils/styles.ts') {
        return dedent`
          import { vindurFn } from 'vindur';
          export const spacing = vindurFn((size: number) => \`padding: \${size}px\`);
        `;
      }
      throw new Error(`File not found: ${String(path)}`);
    });

    await valid({
      code: dedent`
        import { css } from 'vindur';
        import { spacing } from '@/utils/styles';
        const styles = css\`
          color: red;
          \${spacing(16)}
        \`;
      `,
      options: [
        {
          importAliases: { '@': '/src' },
        },
      ],
    });
  });

  test('variable interpolation from external file', async () => {
    // Mock external file with constants
    mockExistsSync.mockImplementation((path) => {
      return path === '/src/theme/colors.ts';
    });
    mockReadFileSync.mockImplementation((path) => {
      if (path === '/src/theme/colors.ts') {
        return dedent`
          export const BRAND_PRIMARY = '#667eea';
          export const BRAND_SECONDARY = '#764ba2';
        `;
      }
      throw new Error(`File not found: ${String(path)}`);
    });

    await valid({
      code: dedent`
        import { css } from 'vindur';
        import { BRAND_PRIMARY } from '@/theme/colors';
        const styles = css\`
          color: \${BRAND_PRIMARY};
          border: 1px solid \${BRAND_PRIMARY};
        \`;
      `,
      options: [
        {
          importAliases: { '@': '/src' },
        },
      ],
    });
  });

  test('import alias resolving non-existing file should error', async () => {
    const { result } = await invalid({
      code: dedent`
        import { css } from 'vindur';
        import { nonExistent } from '@/missing-file';
        const styles = css\`
          color: \${nonExistent};
        \`;
      `,
      options: [
        {
          importAliases: { '@': '/src' },
        },
      ],
    });

    expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
      [
        {
          "line": 1,
          "messageId": "transformError",
          "msg": "/test.ts: File not found: /src/missing-file.ts",
        },
      ]
    `);
  });

  test('multiple cross-file imports with mixed types', async () => {
    // Mock multiple external files
    mockExistsSync.mockImplementation((path) => {
      return path === '/src/constants.ts' || path === '/src/mixins.ts';
    });
    mockReadFileSync.mockImplementation((path) => {
      if (path === '/src/constants.ts') {
        return dedent`
          export const BORDER_RADIUS = '8px';
          export const SHADOW_COLOR = 'rgba(0, 0, 0, 0.1)';
        `;
      }
      if (path === '/src/mixins.ts') {
        return dedent`
          import { vindurFn } from 'vindur';
          export const flexCenter = vindurFn(() => \`
            display: flex;
            align-items: center;
            justify-content: center;
          \`);
        `;
      }
      throw new Error(`File not found: ${String(path)}`);
    });

    await valid({
      code: dedent`
        import { css } from 'vindur';
        import { BORDER_RADIUS, SHADOW_COLOR } from '@/constants';
        import { flexCenter } from '@/mixins';
        const styles = css\`
          \${flexCenter()}
          border-radius: \${BORDER_RADIUS};
          box-shadow: 0 2px 4px \${SHADOW_COLOR};
        \`;
      `,
      options: [
        {
          importAliases: { '@': '/src' },
        },
      ],
    });
  });
});
