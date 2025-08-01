import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transform } from '../../src/transform';
import { createFsMock } from '../testUtils';

const importAliases = { '#/': '/' };

describe('function evaluation errors', () => {
  test('missing function file', () => {
    const source = dedent`
      import { css } from 'vindur'
      import { nonExistent } from './missing'

      const style = css\`
        color: \${nonExistent()};
      \`
    `;

    expect(() => {
      transform({
        fileAbsPath: '/test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { nonExistent } from '#/missing'

          const style = css\`
            color: \${nonExistent()};
          \`
        `,
        fs: createFsMock({ 'test.ts': source }),
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.ts: File not found: /missing.ts]`,
    );
  });

  test('function without vindurFn wrapper', () => {
    const fnFile = dedent`
      export const invalidFn = (size: number) => \`width: \${size}px\`
    `;

    expect(() => {
      transform({
        fileAbsPath: '/test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { invalidFn } from '#/functions'

          const style = css\`
            \${invalidFn(10)};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.ts: called a invalid vindur function, style functions must be defined with "vindurFn(() => ...)" function]`,
    );
  });

  test('non-function export', () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const notAFunction = 'just a string'
    `;

    expect(() => {
      transform({
        fileAbsPath: '/test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { notAFunction } from '#/functions'

          const style = css\`
            \${notAFunction()};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.ts: called a invalid vindur function, style functions must be defined with "vindurFn(() => ...)" function]`,
    );
  });

  test('vindurFn with non-function argument', () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const invalidWrapper = vindurFn('not a function')
    `;

    expect(() => {
      transform({
        fileAbsPath: '/test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { invalidWrapper } from '#/functions'

          const style = css\`
            \${invalidWrapper()};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.ts: /functions.ts: vindurFn must be called with a function expression, got object in function "invalidWrapper"]`,
    );
  });

  test('vindurFn with complex function body', () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const complexFn = vindurFn((size: number) => {
        const computed = size * 2;
        if (computed > 100) {
          return \`width: 100px\`;
        }
        return \`width: \${computed}px\`;
      })
    `;

    expect(() => {
      transform({
        fileAbsPath: '/test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { complexFn } from '#/functions'

          const style = css\`
            \${complexFn(50)};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.ts: /functions.ts: vindurFn "complexFn" body is too complex - functions must contain only a single return statement or be arrow functions with template literals]`,
    );
  });

  test('vindurFn with async function', () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const asyncFn = vindurFn(async (size: number) => \`width: \${size}px\`)
    `;

    expect(() => {
      transform({
        fileAbsPath: '/test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { asyncFn } from '#/functions'

          const style = css\`
            \${asyncFn(10)};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.ts: /functions.ts: vindurFn "asyncFn" cannot be async - functions must be synchronous for compile-time evaluation]`,
    );
  });

  test('vindurFn with generator function', () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const generatorFn = vindurFn(function* (size: number) {
        yield \`width: \${size}px\`;
      })
    `;

    expect(() => {
      transform({
        fileAbsPath: '/test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { generatorFn } from '#/functions'

          const style = css\`
            \${generatorFn(10)};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.ts: /functions.ts: vindurFn "generatorFn" cannot be a generator function - functions must return simple template strings]`,
    );
  });

  test('vindurFn with external dependency', () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'
      import { someExternalLib } from 'external-lib'

      export const externalFn = vindurFn((size: number) => someExternalLib.transform(\`width: \${size}px\`))
    `;

    expect(() => {
      transform({
        fileAbsPath: '/test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { externalFn } from '#/functions'

          const style = css\`
            \${externalFn(10)};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.ts: /functions.ts: vindurFn "externalFn" contains function calls which are not supported - functions must be self-contained]`,
    );
  });

  describe('circular variable references', () => {
    test('direct circular variable reference', () => {
      expect(() => {
        transform({
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'

            const a = b;
            const b = a;

            const style = css\`
              color: \${a};
            \`
          `,
          fs: createFsMock({}),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /test.ts: Invalid interpolation used at \`... style = css\` ... \${a}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported]`,
      );
    });

    test('self-referential variable', () => {
      expect(() => {
        transform({
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'

            const a = a;

            const style = css\`
              color: \${a};
            \`
          `,
          fs: createFsMock({}),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /test.ts: Invalid interpolation used at \`... style = css\` ... \${a}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported]`,
      );
    });

    test('indirect circular variable reference chain', () => {
      expect(() => {
        transform({
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'

            const a = b;
            const b = c;
            const c = a;

            const style = css\`
              color: \${a};
            \`
          `,
          fs: createFsMock({}),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /test.ts: Invalid interpolation used at \`... style = css\` ... \${a}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported]`,
      );
    });

    test('circular reference in template literal expressions', () => {
      expect(() => {
        transform({
          fileAbsPath: '/test.ts',
          source: dedent`
            import { css } from 'vindur'

            const prefix = \`prefix-\${suffix}\`;
            const suffix = \`suffix-\${prefix}\`;

            const style = css\`
              color: \${prefix};
            \`
          `,
          fs: createFsMock({}),
          importAliases,
        });
      }).toThrowErrorMatchingInlineSnapshot(
        `[Error: /test.ts: Invalid interpolation used at \`... style = css\` ... \${prefix}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported]`,
      );
    });
  });
});
