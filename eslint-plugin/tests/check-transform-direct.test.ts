import { describe, expect, test, vi } from 'vitest';
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

describe('check-transform rule direct tests', () => {
  describe('valid cases - should not report errors', () => {
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

    test('files without vindur content are skipped', () => {
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

  describe('rule metadata', () => {
    test('has correct meta information', () => {
      expect(checkTransformRule.meta.type).toBe('problem');
      expect(checkTransformRule.meta.docs?.description).toBe('Detect Vindur transform errors and warnings');
      expect(checkTransformRule.meta.messages.transformError).toBe('{{message}}');
      expect(checkTransformRule.meta.messages.transformWarning).toBe('{{message}}');
    });

    test('has correct schema', () => {
      expect(Array.isArray(checkTransformRule.meta.schema)).toBe(true);
      expect(checkTransformRule.meta.schema).toHaveLength(1);
      expect(checkTransformRule.meta.schema[0]).toMatchObject({
        type: 'object',
        properties: {
          importAliases: { type: 'object' },
          dev: { type: 'boolean' },
          reportWarnings: { type: 'boolean' },
        },
      });
    });
  });
});