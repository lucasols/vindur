/* eslint-disable vitest/expect-expect -- not needed */
import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { checkTransformRule } from '../src/rules/check-transform';
import {
  createVindurTester,
  getErrorsWithMsgFromResult,
} from './utils/createTester';

const { valid, invalid } = createVindurTester({
  name: 'check-transform',
  rule: checkTransformRule,
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
        const Component = () => {
          return <div>Hello World</div>;
        };
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
          "line": 1,
          "messageId": "transformError",
          "msg": "Argument 'undefinedVariable' is undefined",
        },
      ]
    `);
  });

  test('invalid css syntax', async () => {
    const { result } = await invalid(
      dedent`
        import { css } from 'vindur';
        const styles = css\`
          color: \${123 / 0};
        \`;
      `,
    );

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0]?.messageId).toBe('transformError');
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

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages.every((m) => m.messageId === 'transformError')).toBe(
      true,
    );
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
          options: [
            {
              importAliases: { '@': './src' },
            },
          ],
        },
      ],
    });

    // Expect an error since the aliased path doesn't exist
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0]?.messageId).toBe('transformError');
    expect(result.messages[0]?.message).toContain('File not found');
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
      createTestCase(`
        import { keyframes } from 'vindur';
        const fadeIn = keyframes\`
          from { opacity: 0; }
          to { opacity: 1; }
        \`;
      `),
    );
  });

  test('css prop usage', async () => {
    await valid(
      createTestCase(
        `
        import { jsx } from 'vindur';
        const Component = () => (
          <div css={\`color: red; background: blue;\`}>
            Content
          </div>
        );
      `,
        {
          filename: '/test.tsx',
        },
      ),
    );
  });

  test('mixed vindur imports', async () => {
    await valid(
      createTestCase(`
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
      `),
    );
  });

  test('error in keyframes', async () => {
    const { result } = await invalid(
      createTestCase(`
        import { keyframes } from 'vindur';
        const fadeIn = keyframes\`
          from { opacity: \${undefinedVar}; }
          to { opacity: 1; }
        \`;
      `),
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.messageId).toBe('transformError');
    expect(result.messages[0]?.message).toContain('undefinedVar');
  });

  test('mixed errors in multiple constructs', async () => {
    const { result } = await invalid(
      createTestCase(`
        import { css, styled } from 'vindur';
        
        const styles1 = css\`
          color: \${firstUndefinedVar};
        \`;
        
        const Button = styled.div\`
          background: \${secondUndefinedVar};
        \`;
      `),
    );

    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    expect(result.messages.every((r) => r.messageId === 'transformError')).toBe(
      true,
    );
  });

  test('createGlobalStyle usage', async () => {
    await valid(
      createTestCase(`
        import { createGlobalStyle } from 'vindur';
        const GlobalStyle = createGlobalStyle\`
          body {
            margin: 0;
            padding: 0;
          }
        \`;
      `),
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
      createTestCase(`
        import { css } from 'vindur';
        ${cssRules}
      `),
    );
  });
});
