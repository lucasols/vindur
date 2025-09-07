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
    throw new Error(`File not found: ${path}`);
  });
});

describe('valid cases - no errors', () => {
  test('regular JavaScript without vindur', async () => {
    await valid(dedent`
      const regularCode = 'hello world';
      console.log(regularCode);
    `);
  });

  test('files in node_modules are skipped', async () => {
    await valid(
      dedent`
        import { css } from 'vindur';
        const styles = css\`color: red;\`;
      `,
    );
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

  test('files without vindur imports', async () => {
    await valid(
      dedent`
        const regularCode = 'hello world';
        console.log(regularCode);
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

  test('invalid css syntax', async () => {
    const { result } = await invalid(
      dedent`
        import { css } from 'vindur';
        const styles = css\`
          color: \${invalidVar};
        \`;
      `,
    );

    expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
      [
        {
          "line": 3,
          "messageId": "transformError",
          "msg": "/test.ts: Invalid interpolation used at \`... styles = css\` ... \${invalidVar}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported",
        },
      ]
    `);
  });

  test('complex vindur usage with errors', async () => {
    const { result } = await invalid(
      dedent`
        import { css, styled } from 'vindur';

        const invalidStyles = css\`
          color: \${nonExistentVar};
          background: red;
        \`;

        const Button = styled.button\`
          padding: 10px;
          color: \${anotherUndefinedVar};
        \`;
      `,
    );

    expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
      [
        {
          "line": 4,
          "messageId": "transformError",
          "msg": "/test.ts: Invalid interpolation used at \`... invalidStyles = css\` ... \${nonExistentVar}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported",
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

describe('comprehensive Vindur transform scenarios', () => {
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

  test('css prop usage', async () => {
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

  test('mixed vindur imports', async () => {
    await valid(
      dedent`
        import { css, styled, keyframes } from 'vindur';

        const fadeIn = keyframes\`
          from { opacity: 0; }
          to { opacity: 1; }
        \`;

        const Button = styled.button\`
          animation: \${fadeIn} 1s ease-in;
          background: blue;
        \`;

        const extraStyles = css\`
          margin: 10px;
          padding: 5px;
        \`;
      `,
    );
  });

  test('error in keyframes', async () => {
    const { result } = await invalid(
      dedent`
        import { keyframes } from 'vindur';
        const fadeIn = keyframes\`
          from { opacity: \${undefinedVar}; }
          to { opacity: 1; }
        \`;
      `,
    );

    expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
      [
        {
          "line": 3,
          "messageId": "transformError",
          "msg": "/test.ts: Invalid interpolation used at \`... fadeIn = css\` ... \${undefinedVar}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported",
        },
      ]
    `);
  });

  test('mixed errors in multiple constructs', async () => {
    const { result } = await invalid(
      dedent`
        import { css, styled } from 'vindur';

        const styles1 = css\`
          color: \${firstUndefinedVar};
        \`;

        const Button = styled.div\`
          background: \${secondUndefinedVar};
        \`;
      `,
    );

    expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
      [
        {
          "line": 4,
          "messageId": "transformError",
          "msg": "/test.ts: Invalid interpolation used at \`... styles1 = css\` ... \${firstUndefinedVar}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported",
        },
      ]
    `);
  });

  test('createGlobalStyle usage', async () => {
    await valid(
      dedent`
        import { createGlobalStyle } from 'vindur';
        const GlobalStyle = createGlobalStyle\`
          body {
            margin: 0;
            padding: 0;
          }
        \`;
      `,
    );
  });

  test('large file performance', async () => {
    // Test that large files don't cause issues
    const cssRules = Array.from(
      { length: 50 },
      (_, i) => `
      const styles${i} = css\`
        color: ${i % 2 === 0 ? 'red' : 'blue'};
        margin: ${i}px;
      \`;
    `,
    ).join('\n');

    await valid(
      dedent`
        import { css } from 'vindur';
        ${cssRules}
      `,
    );
  });
});

describe('file system mocking scenarios', () => {
  test('import aliases with existing file', async () => {
    // Mock file system to simulate existing file
    mockExistsSync.mockImplementation((path: PathLike) => {
      return path === '/src/vindur.js';
    });
    mockReadFileSync.mockImplementation((path: PathOrFileDescriptor) => {
      if (path === '/src/vindur.js') {
        return `
          export const css = () => 'mocked-css-function';
          export const styled = () => 'mocked-styled-function';
        `;
      }
      throw new Error(`File not found: ${path}`);
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
    const { result } = await invalid({
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

    expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
      [
        {
          "line": 1,
          "messageId": "transformError",
          "msg": "/test.ts: File not found: /src/vindur.ts",
        },
      ]
    `);
  });

  test('vindurFn with external file content', async () => {
    // Mock external file with vindur utilities
    mockExistsSync.mockImplementation((path: PathLike) => {
      return path === '/utils/colors.ts';
    });
    mockReadFileSync.mockImplementation((path: PathOrFileDescriptor) => {
      if (path === '/utils/colors.ts') {
        return `
          export const PRIMARY_COLOR = '#007bff';
          export const SECONDARY_COLOR = '#6c757d';
        `;
      }
      throw new Error(`File not found: ${path}`);
    });

    await valid(
      dedent`
        import { css, vindurFn } from 'vindur';
        import { PRIMARY_COLOR } from './colors';

        const dynamicStyle = vindurFn((color: string) => \`
          background: \${color};
          color: white;
        \`);

        const styles = css\`
          color: \${PRIMARY_COLOR};
        \`;
      `,
    );
  });

  test('multiple file imports with mixed existence', async () => {
    mockExistsSync.mockImplementation((path: PathLike) => {
      return path === '/components/Button.ts'; // Only this file exists
    });
    mockReadFileSync.mockImplementation((path: PathOrFileDescriptor) => {
      if (path === '/components/Button.ts') {
        return `
          export const buttonStyles = 'button-styles';
        `;
      }
      throw new Error(`File not found: ${path}`);
    });

    const { result } = await invalid(
      dedent`
        import { css } from 'vindur';
        import { buttonStyles } from './Button'; // exists
        import { cardStyles } from './Card'; // doesn't exist

        const styles = css\`
          color: red;
          \${buttonStyles}
          \${cardStyles}
        \`;
      `,
    );

    expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
      [
        {
          "line": 7,
          "messageId": "transformError",
          "msg": "/test.ts: Invalid interpolation used at \`... styles = css\` ... \${buttonStyles}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported",
        },
      ]
    `);
  });

  test('complex import alias resolution', async () => {
    // Mock multiple alias paths
    mockExistsSync.mockImplementation((path: PathLike) => {
      return (
        path === '/src/styles/theme.ts' || path === '/src/components/base.ts'
      );
    });
    mockReadFileSync.mockImplementation((path: PathOrFileDescriptor) => {
      if (path === '/src/styles/theme.ts') {
        return `
          export const theme = {
            colors: { primary: '#007bff' },
            spacing: { md: '16px' }
          };
        `;
      }
      if (path === '/src/components/base.ts') {
        return `
          export const baseStyles = 'base-component-styles';
        `;
      }
      throw new Error(`File not found: ${path}`);
    });

    await valid({
      code: dedent`
        import { css } from 'vindur';
        import { theme } from '@styles/theme';
        import { baseStyles } from '@components/base';

        const styles = css\`
          color: \${theme.colors.primary};
          padding: \${theme.spacing.md};
          \${baseStyles}
        \`;
      `,
      options: [
        {
          importAliases: {
            '@styles': '/src/styles',
            '@components': '/src/components',
          },
        },
      ],
    });
  });
});
