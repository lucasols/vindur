import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { TransformError } from '../../src/transform';
import { createFsMock, transformWithFormat } from '../testUtils';

test('interpolates all standard Math constants', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      export const style = css\`
        --pi: \${Math.PI};
        --e: \${Math.E};
        --ln2: \${Math.LN2};
        --ln10: \${Math.LN10};
        --log2e: \${Math.LOG2E};
        --log10e: \${Math.LOG10E};
        --sqrt-half: \${Math.SQRT1_2};
        --sqrt2: \${Math.SQRT2};
        --twice-pi: \${2 * Math.PI};
        --negative-pi: \${-Math.PI};
      \`;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const style = "v1560qbr-1-style";
    "
  `);
  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      --pi: 3.141592653589793;
      --e: 2.718281828459045;
      --ln2: 0.6931471805599453;
      --ln10: 2.302585092994046;
      --log2e: 1.4426950408889634;
      --log10e: 0.4342944819032518;
      --sqrt-half: 0.7071067811865476;
      --sqrt2: 1.4142135623730951;
      --twice-pi: 6.283185307179586;
      --negative-pi: -3.141592653589793;
    }
    "
  `);
});

test('evaluates a ring circumference from module constants', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      const RING_RADIUS = 20;
      const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

      const Ring = styled.svg\`
        stroke-dasharray: \${RING_CIRCUMFERENCE};
      \`;
      export const App = () => <Ring />;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const RING_RADIUS = 20;
    const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
    export const App = () => <svg className="v1560qbr-1-Ring" />;
    "
  `);
  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Ring {
      stroke-dasharray: 125.66370614359172;
    }
    "
  `);
});

test('evaluates imported constants defined with Math constants', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { circumference } from '#/constants';
      export const style = css\`stroke-dasharray: \${circumference};\`;
    `,
    overrideDefaultFs: createFsMock({
      'constants.ts': dedent`
        const radius = 20;
        export const circumference = 2 * Math.PI * radius;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const style = "v1560qbr-1-style";
    "
  `);
  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      stroke-dasharray: 125.66370614359172;
    }
    "
  `);
});

test('resolves a module binding named Math using its own value', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      const Math = { PI: 3 };
      const pi = Math.PI;
      export const style = css\`--pi: \${pi};\`;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const Math = {
      PI: 3,
    };
    const pi = Math.PI;
    export const style = "v1560qbr-1-style";
    "
  `);
  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      --pi: 3;
    }
    "
  `);
});

test('rejects a runtime parameter named Math with a source location', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        export function makeStyle(Math) {
          return css\`--pi: \${Math.PI};\`;
        }
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`css\` ... \${Math.PI}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
    loc: 3:21]
  `);
});

test.each(['Math.UNKNOWN', 'Math.random()', 'Math.sin(0)'])(
  'rejects unsupported Math expression %s',
  async (expression) => {
    await expect(
      transformWithFormat({
        source: `import { css } from 'vindur'; export const style = css\`--value: \${${expression}};\`;`,
      }),
    ).rejects.toThrowError(TransformError);
  },
);
