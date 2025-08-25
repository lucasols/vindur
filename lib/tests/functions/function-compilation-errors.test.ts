import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transform } from '../../src/transform';
import { createFsMock } from '../testUtils';

const importAliases = { '#/': '/' };

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
            import { theme } from '#/functions'

            const style = css\`
              \${theme(1.5)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: Invalid interpolation used at \`... theme = vindurFn((multiplier) => \` ... \${primaryColor}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
        loc: {
          "column": 11,
          "filename": "/functions.ts",
          "line": 6,
        }]
      `,
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
            import { fontSize } from '#/functions'

            const style = css\`
              \${fontSize(2)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: Invalid interpolation used at \`... fontSize = vindurFn((scale) => \` ... \${baseSize}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
        loc: {
          "column": 15,
          "filename": "/functions.ts",
          "line": 6,
        }]
      `,
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
            import { className } from '#/functions'

            const style = css\`
              \${className('primary')};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: Invalid interpolation used at \`... className = vindurFn((variant) => \` ... \${prefix}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
        loc: {
          "column": 14,
          "filename": "/functions.ts",
          "line": 6,
        }]
      `,
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
            import { color } from '#/functions'

            const style = css\`
              \${color(0.5)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "color" contains member expressions which suggest external dependencies - functions must be self-contained
        loc: {
          "column": 11,
          "filename": "/functions.ts",
          "line": 6,
        }]
      `,
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
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { invalidOp } from '#/functions'

            const style = css\`
              \${invalidOp(1, 2)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "invalidOp" contains unsupported comparison operator "==" - only ===, !==, >, <, >=, <= are supported
        loc: {
          "column": 11,
          "filename": "/functions.ts",
          "line": 4,
        }]
      `,
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
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { logicalAnd } from '#/functions'

            const style = css\`
              \${logicalAnd(1, 2)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "logicalAnd" contains unsupported ternary condition type: LogicalExpression
        loc: {
          "column": 11,
          "filename": "/functions.ts",
          "line": 4,
        }]
      `,
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
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { fnCall } from '#/functions'

            const style = css\`
              \${fnCall(10)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "fnCall" contains function calls which are not supported - functions must be self-contained
        loc: {
          "column": 11,
          "filename": "/functions.ts",
          "line": 4,
        }]
      `,
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
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { memberExpr } from '#/functions'

            const style = css\`
              \${memberExpr({value: 10})};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "memberExpr" contains member expressions which suggest external dependencies - functions must be self-contained
        loc: {
          "column": 11,
          "filename": "/functions.ts",
          "line": 4,
        }]
      `,
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
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { arrayAccess } from '#/functions'

            const style = css\`
              \${arrayAccess([1, 2, 3])};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "arrayAccess" contains member expressions which suggest external dependencies - functions must be self-contained
        loc: {
          "column": 11,
          "filename": "/functions.ts",
          "line": 4,
        }]
      `,
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
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { complexExpr } from '#/functions'

            const style = css\`
              \${complexExpr(1)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "complexExpr" contains unsupported condition value type: BinaryExpression
        loc: {
          "column": 11,
          "filename": "/functions.ts",
          "line": 4,
        }]
      `,
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
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { objLiteral } from '#/functions'

            const style = css\`
              \${objLiteral(5)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "objLiteral" contains unsupported condition value type: ObjectExpression
        loc: {
          "column": 11,
          "filename": "/functions.ts",
          "line": 4,
        }]
      `,
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
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { arrLiteral } from '#/functions'

            const style = css\`
              \${arrLiteral(5)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "arrLiteral" contains unsupported condition value type: ArrayExpression
        loc: {
          "column": 11,
          "filename": "/functions.ts",
          "line": 4,
        }]
      `,
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
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { fnInBranch } from '#/functions'

            const style = css\`
              \${fnInBranch(true)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "fnInBranch" contains unsupported function calls - only array methods like .join() are supported
        loc: {
          "column": 20,
          "filename": "/functions.ts",
          "line": 4,
        }]
      `,
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
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { memberInBranch } from '#/functions'

            const style = css\`
              \${memberInBranch({color: 'red'}, true)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "memberInBranch" contains member expressions which suggest external dependencies - functions must be self-contained
        loc: {
          "column": 18,
          "filename": "/functions.ts",
          "line": 4,
        }]
      `,
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
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'
            import { unsupportedExpr } from '#/functions'

            const style = css\`
              \${unsupportedExpr(true)};
            \`
          `,
          fs: createFsMock({ 'functions.ts': fnFile }),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "unsupportedExpr" contains unsupported expression type in ternary: NewExpression
        loc: {
          "column": 18,
          "filename": "/functions.ts",
          "line": 4,
        }]
      `,
      );
    });
  });

  describe('local vindurFn declarations', () => {
    test('should throw error when vindurFn is declared locally', () => {
      expect(() => {
        transform({
          fileAbsPath: '/test.ts',
          source: dedent`
            import { vindurFn } from 'vindur'

            const spacing = vindurFn((size: number) => \`\${size}px\`)
          `,
          fs: createFsMock({}),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: vindurFn "spacing" must be exported, locally declared vindurFn functions are not supported. If you are trying to use a vindurFn function, you must import it from another file.
        loc: {
          "column": 6,
          "filename": "/test.ts",
          "line": 3,
        }]
      `,
      );
    });

    test('should throw error when vindurFn is used in styled component', () => {
      expect(() => {
        transform({
          fileAbsPath: '/test.ts',
          source: dedent`
            import { vindurFn, styled } from 'vindur'

            const spacing = vindurFn((size: number) => \`\${size}px\`)

            const Container = styled.div\`
              margin: \${spacing(16)};
            \`
          `,
          fs: createFsMock({}),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: vindurFn "spacing" must be exported, locally declared vindurFn functions are not supported. If you are trying to use a vindurFn function, you must import it from another file.
        loc: {
          "column": 6,
          "filename": "/test.ts",
          "line": 3,
        }]
      `,
      );
    });
  });
});
