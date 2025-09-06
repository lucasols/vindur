import { describe, expect, test } from 'vitest';
import { dedent } from '@ls-stack/utils/dedent';
import { checkTransformRule } from '../src/rules/check-transform';

// Mock context for testing the rule
function createMockContext(filename: string, source: string, options: any[] = []) {
  const reports: Array<{
    messageId: string;
    data: Record<string, string>;
    loc?: { line: number; column: number };
  }> = [];

  return {
    filename,
    sourceCode: {
      getText: () => source,
    },
    options,
    report: (data: any) => {
      reports.push(data);
    },
    getReports: () => reports,
  };
}

describe('valid cases - no errors', () => {
  test('regular JavaScript without vindur', () => {
    const source = dedent`
      const regularCode = 'hello world';
      console.log(regularCode);
    `;
    
    const context = createMockContext('/test.js', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'script',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 2, column: 0 } },
    } as any);
    
    expect(context.getReports()).toEqual([]);
  });

  test('files in node_modules are skipped', () => {
    const source = dedent`
      import { css } from 'vindur';
      const styles = css\`color: red;\`;
    `;
    
    const context = createMockContext('/node_modules/some-package/file.ts', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 2, column: 0 } },
    } as any);
    
    expect(context.getReports()).toEqual([]);
  });

  test('valid vindur css usage', () => {
    const source = dedent`
      import { css } from 'vindur';
      const styles = css\`
        color: red;
        background: blue;
      \`;
    `;
    
    const context = createMockContext('/test.ts', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 5, column: 0 } },
    } as any);
    
    expect(context.getReports()).toEqual([]);
  });

  test('valid styled component usage', () => {
    const source = dedent`
      import { styled } from 'vindur';
      const Button = styled.button\`
        color: white;
        background: blue;
      \`;
    `;
    
    const context = createMockContext('/test.ts', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 5, column: 0 } },
    } as any);
    
    expect(context.getReports()).toEqual([]);
  });

  test('files without vindur imports', () => {
    const source = dedent`
      const Component = () => {
        return <div>Hello World</div>;
      };
    `;
    
    const context = createMockContext('/test.tsx', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 3, column: 0 } },
    } as any);
    
    expect(context.getReports()).toEqual([]);
  });
});

describe('invalid cases - should report transform errors', () => {
  test('undefined variable in css template', () => {
    const source = dedent`
      import { css } from 'vindur';
      const styles = css\`
        color: \${undefinedVariable};
      \`;
    `;
    
    const context = createMockContext('/test.ts', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 4, column: 0 } },
    } as any);
    
    const reports = context.getReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]?.messageId).toBe('transformError');
    expect(reports[0]?.data.message).toContain('undefinedVariable');
  });

  test('invalid template literal usage', () => {
    const source = dedent`
      import { css } from 'vindur';
      const styles = css\`
        color: \${someFunction()};
      \`;
    `;
    
    const context = createMockContext('/test.ts', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 4, column: 0 } },
    } as any);
    
    const reports = context.getReports();
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0]?.messageId).toBe('transformError');
  });

  test('complex vindur usage with errors', () => {
    const source = dedent`
      import { css, styled } from 'vindur';
      
      const invalidStyles = css\`
        color: \${nonExistentVar};
        background: red;
      \`;
      
      const Button = styled.button\`
        padding: 10px;
        color: \${anotherUndefinedVar};
      \`;
    `;
    
    const context = createMockContext('/test.ts', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 11, column: 0 } },
    } as any);
    
    const reports = context.getReports();
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every(r => r.messageId === 'transformError')).toBe(true);
  });
});

describe('rule options', () => {
  test('dev mode disabled', () => {
    const source = dedent`
      import { css } from 'vindur';
      const styles = css\`color: red;\`;
    `;
    
    const context = createMockContext('/test.ts', source, [{ dev: false }]);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 2, column: 0 } },
    } as any);
    
    expect(context.getReports()).toEqual([]);
  });

  test('import aliases support', () => {
    // This test verifies that import aliases option is properly passed through
    // but doesn't require actual file resolution since the transform errors
    // are expected when the aliased path doesn't exist
    const source = dedent`
      import { css } from '@/vindur';
      const styles = css\`color: red;\`;
    `;
    
    const context = createMockContext('/test.ts', source, [{
      importAliases: { '@': './src' }
    }]);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 2, column: 0 } },
    } as any);
    
    // Expect an error since the aliased path doesn't exist
    const reports = context.getReports();
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0]?.messageId).toBe('transformError');
    expect(reports[0]?.data.message).toContain('File not found');
  });

  test('warnings disabled', () => {
    const source = dedent`
      import { css } from 'vindur';
      const styles = css\`color: red;\`;
    `;
    
    const context = createMockContext('/test.ts', source, [{ reportWarnings: false }]);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 2, column: 0 } },
    } as any);
    
    expect(context.getReports()).toEqual([]);
  });
});

describe('comprehensive Vindur transform scenarios', () => {
  test('keyframes usage', () => {
    const source = dedent`
      import { keyframes } from 'vindur';
      const fadeIn = keyframes\`
        from { opacity: 0; }
        to { opacity: 1; }
      \`;
    `;
    
    const context = createMockContext('/test.ts', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 5, column: 0 } },
    } as any);
    
    expect(context.getReports()).toEqual([]);
  });

  test('css prop usage', () => {
    const source = dedent`
      import { jsx } from 'vindur';
      const Component = () => (
        <div css={\`color: red; background: blue;\`}>
          Content
        </div>
      );
    `;
    
    const context = createMockContext('/test.tsx', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 6, column: 0 } },
    } as any);
    
    expect(context.getReports()).toEqual([]);
  });

  test('mixed vindur imports', () => {
    const source = dedent`
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
    `;
    
    const context = createMockContext('/test.ts', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 17, column: 0 } },
    } as any);
    
    expect(context.getReports()).toEqual([]);
  });

  test('error in keyframes', () => {
    const source = dedent`
      import { keyframes } from 'vindur';
      const fadeIn = keyframes\`
        from { opacity: \${undefinedVar}; }
        to { opacity: 1; }
      \`;
    `;
    
    const context = createMockContext('/test.ts', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 5, column: 0 } },
    } as any);
    
    const reports = context.getReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]?.messageId).toBe('transformError');
    expect(reports[0]?.data.message).toContain('undefinedVar');
  });

  test('mixed errors in multiple constructs', () => {
    const source = dedent`
      import { css, styled } from 'vindur';
      
      const styles1 = css\`
        color: \${firstUndefinedVar};
      \`;
      
      const Button = styled.div\`
        background: \${secondUndefinedVar};
      \`;
    `;
    
    const context = createMockContext('/test.ts', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 9, column: 0 } },
    } as any);
    
    const reports = context.getReports();
    expect(reports.length).toBeGreaterThanOrEqual(1);
    expect(reports.every(r => r.messageId === 'transformError')).toBe(true);
  });

  test('createGlobalStyle usage', () => {
    const source = dedent`
      import { createGlobalStyle } from 'vindur';
      const GlobalStyle = createGlobalStyle\`
        body {
          margin: 0;
          padding: 0;
        }
      \`;
    `;
    
    const context = createMockContext('/test.ts', source);
    const rule = checkTransformRule.create(context as any);
    
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 7, column: 0 } },
    } as any);
    
    expect(context.getReports()).toEqual([]);
  });

  test('large file performance', () => {
    // Test that large files don't cause issues
    const cssRules = Array.from({ length: 50 }, (_, i) => `
      const styles${i} = css\`
        color: ${i % 2 === 0 ? 'red' : 'blue'};
        margin: ${i}px;
      \`;
    `).join('\n');
    
    const source = dedent`
      import { css } from 'vindur';
      ${cssRules}
    `;
    
    const context = createMockContext('/test.ts', source);
    const rule = checkTransformRule.create(context as any);
    
    const startTime = Date.now();
    rule.Program?.({
      type: 'Program',
      body: [],
      sourceType: 'module',
      range: [0, source.length],
      loc: { start: { line: 1, column: 0 }, end: { line: 200, column: 0 } },
    } as any);
    const endTime = Date.now();
    
    // Should complete within reasonable time (less than 1 second)
    expect(endTime - startTime).toBeLessThan(1000);
    expect(context.getReports()).toEqual([]);
  });
});