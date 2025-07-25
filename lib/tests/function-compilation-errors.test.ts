import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transform } from '../src/transform';
import { createFsMock } from './testUtils';

describe('function compilation errors', () => {
  describe('variable references', () => {
    test('function with simple variable reference should throw error', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        const primaryColor = 'blue'

        export const theme = vindurFn((multiplier: number) => \`
          color: \${primaryColor};
          font-size: \${multiplier}px;
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { theme } from './functions'

            const style = css\`
              \${theme(1.5)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /test.ts: Invalid interpolation used at \`... theme = vindurFn((multiplier: number) => \` ... \${primaryColor}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported]`,
      );
    });

    test('function with arithmetic using variable should throw error', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        const baseSize = 16

        export const fontSize = vindurFn((scale: number) => \`
          font-size: \${baseSize * scale}px;
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { fontSize } from './functions'

            const style = css\`
              \${fontSize(2)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /test.ts: Invalid interpolation used at \`... fontSize = vindurFn((scale: number) => \` ... \${baseSize * scale}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported]`,
      );
    });

    test('function with variable in string interpolation should throw error', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        const prefix = 'app'

        export const className = vindurFn((variant: string) => \`
          content: "\${prefix}-\${variant}";
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { className } from './functions'

            const style = css\`
              \${className('primary')};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /test.ts: Invalid interpolation used at \`... className = vindurFn((variant: string) => \` ... \${prefix}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported]`,
      );
    });

    test('function with object property access should throw error', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        const theme = { primary: 'blue' }

        export const color = vindurFn((opacity: number) => \`
          color: \${theme.primary};
          opacity: \${opacity};
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { color } from './functions'

            const style = css\`
              \${color(0.5)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /test.ts: Invalid interpolation used at \`... color = vindurFn((opacity: number) => \` ... \${theme.primary}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported]`,
      );
    });
  });

  describe('ternary condition validation', () => {
    test('invalid comparison operator in ternary condition', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        export const invalidOp = vindurFn((a: number, b: number) => \`
          color: \${a == b ? 'red' : 'blue'};
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: 'test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { invalidOp } from './functions'

            const style = css\`
              \${invalidOp(1, 2)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "invalidOp" contains unsupported comparison operator "==" - only ===, !==, >, <, >=, <= are supported]`,
      );
    });

    test('logical AND operator in ternary condition', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        export const logicalAnd = vindurFn((a: number, b: number) => \`
          color: \${a && b ? 'red' : 'blue'};
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: 'test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { logicalAnd } from './functions'

            const style = css\`
              \${logicalAnd(1, 2)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "logicalAnd" contains unsupported ternary condition type: LogicalExpression]`,
      );
    });

    test('function call in ternary condition', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        export const fnCall = vindurFn((a: number) => \`
          color: \${Math.abs(a) > 5 ? 'red' : 'blue'};
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: 'test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { fnCall } from './functions'

            const style = css\`
              \${fnCall(10)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "fnCall" contains function calls which are not supported - functions must be self-contained]`,
      );
    });

    test('member expression in ternary condition', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        export const memberExpr = vindurFn((obj: any) => \`
          color: \${obj.value > 5 ? 'red' : 'blue'};
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: 'test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { memberExpr } from './functions'

            const style = css\`
              \${memberExpr({value: 10})};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "memberExpr" contains member expressions which suggest external dependencies - functions must be self-contained]`,
      );
    });

    test('array access in ternary condition', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        export const arrayAccess = vindurFn((arr: number[]) => \`
          color: \${arr[0] > 5 ? 'red' : 'blue'};
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: 'test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { arrayAccess } from './functions'

            const style = css\`
              \${arrayAccess([1, 2, 3])};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "arrayAccess" contains member expressions which suggest external dependencies - functions must be self-contained]`,
      );
    });

    test('complex expression in ternary condition', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        export const complexExpr = vindurFn((a: number) => \`
          color: \${(a + 5) * 2 > 10 ? 'red' : 'blue'};
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: 'test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { complexExpr } from './functions'

            const style = css\`
              \${complexExpr(1)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "complexExpr" contains unsupported condition value type: BinaryExpression]`,
      );
    });

    test('object literal in ternary condition', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        export const objLiteral = vindurFn((value: number) => \`
          color: \${{value} === value ? 'red' : 'blue'};
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: 'test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { objLiteral } from './functions'

            const style = css\`
              \${objLiteral(5)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "objLiteral" contains unsupported condition value type: ObjectExpression]`,
      );
    });

    test('array literal in ternary condition', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        export const arrLiteral = vindurFn((value: number) => \`
          color: \${[value] === value ? 'red' : 'blue'};
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: 'test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { arrLiteral } from './functions'

            const style = css\`
              \${arrLiteral(5)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "arrLiteral" contains unsupported condition value type: ArrayExpression]`,
      );
    });

    test('function call in ternary branch', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        export const fnInBranch = vindurFn((show: boolean) => \`
          display: \${show ? getDisplay() : 'none'};
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: 'test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { fnInBranch } from './functions'

            const style = css\`
              \${fnInBranch(true)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "fnInBranch" contains function calls which are not supported - functions must be self-contained]`,
      );
    });

    test('member expression in ternary branch', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        export const memberInBranch = vindurFn((obj: any, show: boolean) => \`
          color: \${show ? obj.color : 'default'};
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: 'test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { memberInBranch } from './functions'

            const style = css\`
              \${memberInBranch({color: 'red'}, true)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "memberInBranch" contains member expressions which suggest external dependencies - functions must be self-contained]`,
      );
    });

    test('unsupported expression type in ternary branch', () => {
      const fnFile = dedent`
        import { vindurFn } from 'vindur'

        export const unsupportedExpr = vindurFn((show: boolean) => \`
          color: \${show ? new Date() : 'default'};
        \`)
      `;

      expect(() => {
        transform({
          fileAbsPath: 'test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { unsupportedExpr } from './functions'

            const style = css\`
              \${unsupportedExpr(true)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "unsupportedExpr" contains unsupported expression type in ternary: NewExpression]`,
      );
    });
  });
});
