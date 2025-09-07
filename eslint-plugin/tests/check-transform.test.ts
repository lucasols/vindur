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
          "msg": "Invalid interpolation used at \`... styles = css\` ... \${undefinedVariable}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported",
        },
      ]
    `);
  });
});

describe('basic error handling', () => {
  test('should properly handle module not found errors', async () => {
    const { result } = await invalid(dedent`
      import { css } from 'vindur';
      import { unknownVar } from './nonexistent';
      const styles = css\`color: \${unknownVar};\`;
    `);

    expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
      [
        {
          "line": 3,
          "messageId": "transformError",
          "msg": "Invalid interpolation used at \`... styles = css\` ... \${unknownVar}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported",
        },
      ]
    `);
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


describe('warning system - onWarning callback functionality', () => {
  describe('style flags warnings', () => {
    test('should report warnings for missing boolean modifier styles', async () => {
      const { result } = await invalid(dedent`
        import { styled } from 'vindur';

        const Button = styled.button<{
          active: boolean;
        }>\`
          padding: 8px 16px;
          color: blue;
        \`;
      `);

      expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
        [
          {
            "line": 3,
            "messageId": "transformWarning",
            "msg": "Warning: Missing modifier styles for "&.active" in Button",
          },
        ]
      `);
    });

    test('should report warnings for missing string union modifier styles', async () => {
      const { result } = await invalid(dedent`
        import { styled } from 'vindur';

        const Button = styled.button<{
          size: 'small' | 'large';
        }>\`
          padding: 8px 16px;
          color: blue;
        \`;
      `);

      expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
        [
          {
            "line": 3,
            "messageId": "transformWarning",
            "msg": "Warning: Missing modifier styles for "&.size-small" in Button",
          },
          {
            "line": 3,
            "messageId": "transformWarning",
            "msg": "Warning: Missing modifier styles for "&.size-large" in Button",
          },
        ]
      `);
    });

    test('should report warnings for mixed missing modifier styles', async () => {
      const { result } = await invalid(dedent`
        import { styled } from 'vindur';

        const ComplexButton = styled.button<{
          active: boolean;
          disabled: boolean;
          size: 'small' | 'large';
        }>\`
          padding: 8px 16px;

          &.active {
            transform: scale(1.05);
          }

          &.size-small {
            padding: 4px 8px;
          }
        \`;
      `);

      expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
        [
          {
            "line": 3,
            "messageId": "transformWarning",
            "msg": "Warning: Missing modifier styles for "&.disabled" in ComplexButton",
          },
          {
            "line": 3,
            "messageId": "transformWarning",
            "msg": "Warning: Missing modifier styles for "&.size-large" in ComplexButton",
          },
        ]
      `);
    });

  });

  describe('scoped CSS variable warnings', () => {
    test('should report warnings for unused scoped variables', async () => {
      const { result } = await invalid(dedent`
        import { styled } from 'vindur';

        const Card = styled.div\`
          ---primary-color: #007bff;
          ---unused-color: #ff0000;

          background: var(---primary-color);
        \`;
      `);

      expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
        [
          {
            "line": 3,
            "messageId": "transformWarning",
            "msg": "Scoped variable '---unused-color' is declared but never read",
          },
        ]
      `);
    });

    test('should report warnings for undeclared scoped variables', async () => {
      const { result } = await invalid(dedent`
        import { styled } from 'vindur';

        const Card = styled.div\`
          ---primary-color: #007bff;

          background: var(---primary-color);
          border: 1px solid var(---theme-color);
        \`;
      `);

      expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
        [
          {
            "line": 1,
            "messageId": "transformWarning",
            "msg": "Scoped variable '---theme-color' is used but never declared",
          },
        ]
      `);
    });
  });

  describe('cx prop warnings', () => {
    test('should report warnings for missing CSS classes in cx modifiers', async () => {
      const { result } = await invalid(dedent`
        import { styled, cx } from 'vindur';

        const Card = styled.div\`
          background: white;
          padding: 16px;

          &.active {
            background: blue;
          }

          &.disabled {
            opacity: 0.5;
          }
        \`;

        function Component({ isActive, isDisabled, isHighlighted }) {
          return (
            <Card cx={{ active: isActive, disabled: isDisabled, highlighted: isHighlighted }}>
              Content
            </Card>
          );
        }
      `);

      expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
        [
          {
            "line": 18,
            "messageId": "transformWarning",
            "msg": "Warning: Missing CSS classes for cx modifiers in Card: highlighted",
          },
        ]
      `);
    });

    test('should exclude $ prefixed props from warnings', async () => {
      const { result } = await invalid(dedent`
        import { styled, cx } from 'vindur';

        const Widget = styled.div\`
          padding: 10px;

          &.active {
            background: blue;
          }
        \`;

        function Component({ isActive, hasError, hasWarning }) {
          return <Widget cx={{ active: isActive, $error: hasError, warning: hasWarning }} />;
        }
      `);

      expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
        [
          {
            "line": 12,
            "messageId": "transformWarning",
            "msg": "Warning: Missing CSS classes for cx modifiers in Widget: warning",
          },
        ]
      `);
    });
  });


  describe('warnings vs errors distinction', () => {
    test('should report transform errors as errors and warnings as warnings', async () => {
      const { result } = await invalid(dedent`
        import { styled } from 'vindur';

        const Button = styled.button<{
          active: boolean;
        }>\`
          padding: 8px 16px;
          color: \${undefinedVariable};
        \`;
      `);

      expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
        [
          {
            "line": 7,
            "messageId": "transformError",
            "msg": "Invalid interpolation used at \`... Button = styled\` ... \${undefinedVariable}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported",
          },
        ]
      `);
    });
  });
});

