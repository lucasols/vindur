import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transform } from '../../src/transform';
import { createFsMock, transformWithFormat } from '../testUtils';

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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: Invalid interpolation used at \`... theme = vindurFn((multiplier) => \` ... \${primaryColor}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
        loc: /functions.ts|6:11]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: Invalid interpolation used at \`... fontSize = vindurFn((scale) => \` ... \${baseSize}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
        loc: /functions.ts|6:15]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: Invalid interpolation used at \`... className = vindurFn((variant) => \` ... \${prefix}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
        loc: /functions.ts|6:14]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "color" contains member expressions which suggest external dependencies - functions must be self-contained
        loc: /functions.ts|6:11]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "invalidOp" contains unsupported comparison operator "==" - only ===, !==, >, <, >=, <= are supported
        loc: /functions.ts|4:11]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "logicalAnd" contains unsupported ternary condition type: LogicalExpression
        loc: /functions.ts|4:11]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "fnCall" contains function calls which are not supported - functions must be self-contained
        loc: /functions.ts|4:11]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "memberExpr" contains member expressions which suggest external dependencies - functions must be self-contained
        loc: /functions.ts|4:11]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "arrayAccess" contains member expressions which suggest external dependencies - functions must be self-contained
        loc: /functions.ts|4:11]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "complexExpr" contains unsupported condition value type: BinaryExpression
        loc: /functions.ts|4:11]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "objLiteral" contains unsupported condition value type: ObjectExpression
        loc: /functions.ts|4:11]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "arrLiteral" contains unsupported condition value type: ArrayExpression
        loc: /functions.ts|4:11]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "fnInBranch" contains unsupported function calls - only array methods like .map() and .join() are supported
        loc: /functions.ts|4:20]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "memberInBranch" contains member expressions which suggest external dependencies - functions must be self-contained
        loc: /functions.ts|4:18]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: /functions.ts: vindurFn "unsupportedExpr" contains unsupported expression type in ternary: NewExpression
        loc: /functions.ts|4:18]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: vindurFn "spacing" must be exported, locally declared vindurFn functions are not supported. If you are trying to use a vindurFn function, you must import it from another file.
        loc: /test.ts|3:6]
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
          transformFunctionCache: {},
          transformDynamicColorCache: {},
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `
        [TransformError: /test.ts: vindurFn "spacing" must be exported, locally declared vindurFn functions are not supported. If you are trying to use a vindurFn function, you must import it from another file.
        loc: /test.ts|3:6]
      `,
      );
    });
  });
});

test('should error on vindurFn declared with let', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export let transition = vindurFn((property: string) => \`transition: \${property};\`);
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" is not supported, vindur functions must be declared with "export const transition = vindurFn((...) => ...)"
    loc: /test.tsx|3:11]
  `);
});

test('should error on vindurFn declared with a function expression', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const transition = vindurFn(function (property: string) {
          return \`transition: \${property};\`;
        });
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" is not supported, vindur functions must be declared with "export const transition = vindurFn((...) => ...)"
    loc: /test.tsx|3:13]
  `);
});

test('should error at the unsupported syntax of a vindurFn', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const columns = vindurFn((count: number) => \`--odd: \${count % 2};\`);
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "columns" contains unsupported syntax "count % 2", it can't be evaluated at compile time
    loc: /test.tsx|3:61]
  `);
});

test('should error on wrapped vindurFn declarations', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const transition = (vindurFn((property: string) => \`transition: \${property};\`));
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" is not supported, vindur functions must be declared with "export const transition = vindurFn((...) => ...)"
    loc: /test.tsx|3:13]
  `);
});

test('should validate vindurFn bodies wrapped in type assertions', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const match = vindurFn((n: number) => \`--match: \${n == 10 ? 1 : 0};\` as const);
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "match" contains unsupported comparison operator "==" - only ===, !==, >, <, >=, <= are supported
    loc: /test.tsx|3:57]
  `);
});

test('should error on map callbacks with default parameters', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const sizes = vindurFn((values: number[]) => values.map((n = 10) => \`\${n}px\`).join(' '));
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "sizes" contains unsupported syntax "n = 10", it can't be evaluated at compile time
    loc: /test.tsx|3:64]
  `);
});

test('should error on loose inequality in vindurFn conditions', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const color = vindurFn((value: string) => \`color: \${value != '0' ? 'red' : 'blue'};\`);
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "color" contains unsupported comparison operator "!=" - only ===, !==, >, <, >=, <= are supported
    loc: /test.tsx|3:59]
  `);
});

test('should error on loose equality in vindurFn bodies', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const match = vindurFn((n: number) => \`--match: \${n == 10};\`);
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "match" contains unsupported syntax "n == 10", it can't be evaluated at compile time
    loc: /test.tsx|3:57]
  `);
});

test('should error on unknown references in map callbacks', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        const unit = 'px';

        export const sizes = vindurFn((values: number[]) => values.map((n) => \`\${n}\${unit}\`).join(' '));
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... sizes = vindurFn((n, values) => \` ... \${unit}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
    loc: 5:77]
  `);
});

test('should error on comparing objects in vindurFn', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import { isSame } from '#/functions';

        const theme = { colors: { primary: 'red' } };

        export const box = css\`
          \${isSame(theme)};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'functions.ts': dedent`
          import { vindurFn } from 'vindur';

          export const isSame = vindurFn(({ colors }: { colors: object }) => colors === colors ? 'color: red;' : 'color: blue;');
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Binary expression evaluation failed: only strings, numbers, booleans and undefined can be compared
    loc: 7:4]
  `);
});

test('should error on block bodies without return in vindurFn', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const color = vindurFn((value: string) => { \`color: \${value};\` });
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "color" body is too complex - functions must contain only a single return statement or be arrow functions with template literals
    loc: /test.tsx|3:49]
  `);
});

test('should error on map callbacks with block bodies without return', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const sizes = vindurFn((values: number[]) => values.map((n) => { \`\${n}px\` }).join(' '));
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "sizes" contains unsupported syntax "{ \`\${n}px\` }", it can't be evaluated at compile time
    loc: /test.tsx|3:70]
  `);
});
