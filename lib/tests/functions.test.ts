import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transform } from '../src/transform';
import { createFsMock } from './testUtils';

test('function with simple params', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const pixelSize = vindurFn((size: number) => '\${size}px')
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { pixelSize } from './functions'

      const style = css\`
        width: \${pixelSize(10)};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      width: 10px;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
});

test('function with multiple params', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const margin = vindurFn((top: number, right: number, bottom: number, left: number) => \`
      margin: \${top}px \${right}px \${bottom}px \${left}px;
    \`)
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { margin } from './functions'

      const style = css\`
        \${margin(10, 20, 30, 40)};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      margin: 10px 20px 30px 40px;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
});

test('function with destructured object param', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const inline = vindurFn(({ justify = 'left', align = 'center', gap }) => \`
      display: flex;
      justify-content: \${justify === 'left' ? 'flex-start' : justify === 'right' ? 'flex-end' : 'center'};
      align-items: \${align === 'center' ? 'center' : 'flex-end'};
      gap: \${gap}px;
    \`)
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { inline } from './functions'

      const style = css\`
        \${inline({ gap: 10 })};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      display: flex;
      justify-content: flex-start;
      align-items: center;
      gap: 10px;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
});

test('function with no parameters', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const reset = vindurFn(() => \`
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    \`)
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { reset } from './functions'

      const style = css\`
        \${reset()};
        color: red;
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      color: red;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
});

test('function returning static string', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const border = vindurFn(() => '1px solid black')
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { border } from './functions'

      const style = css\`
        border: \${border()};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      border: 1px solid black;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
});

test('function with simple conditional', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const spacing = vindurFn(({ size = 'medium' }) => \`
      padding: \${size};
    \`)
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { spacing } from './functions'

      const style = css\`
        \${spacing({ size: 'large' })};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      padding: large;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
});

test('multiple functions in one file', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const px = vindurFn((size: number) => '\${size}px')
    export const percent = vindurFn((value: number) => '\${value}%')
    export const color = vindurFn((name: string) => '\${name}')
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { px, percent, color } from './functions'

      const style = css\`
        font-size: \${px(24)};
        width: \${percent(50)};
        background: \${color('red')};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      font-size: 24px;
      width: 50%;
      background: red;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
});

test('function with mixed parameter types', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const shadow = vindurFn((x: number, y: number, blur: number, color: string) => '\${x}px \${y}px \${blur}px \${color}')
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { shadow } from './functions'

      const style = css\`
        box-shadow: \${shadow(2, 4, 8, 'rgba(0,0,0,0.3)')};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      box-shadow: 2px 4px 8px rgba(0,0,0,0.3);
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
});

test('function with all default values used', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const button = vindurFn(({ 
      bg = 'blue', 
      color = 'white', 
      padding = '8px 16px',
      radius = '4px'
    }) => \`
      background: \${bg};
      color: \${color};
      padding: \${padding};
      border-radius: \${radius};
      border: none;
      cursor: pointer;
    \`)
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { button } from './functions'

      const style = css\`
        \${button({})};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      background: blue;
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
});

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
        import { nonExistent } from './missing'

        const style = css\`
          color: \${nonExistent()};
        \`
      `,
      fs: createFsMock({ 'test.ts': source }),
    });
  }).toThrowErrorMatchingInlineSnapshot(
    `[Error: /test.ts: File not found: missing.ts]`,
  );
});

test('function with simple interpolation', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const grid = vindurFn((cols: number, gap: number) => \`
      display: grid;
      grid-template-columns: repeat(\${cols}, 1fr);
      gap: \${gap}px;
    \`)
  `;

  const { code, css } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { grid } from './functions'

      const style = css\`
        \${grid(3, 16)};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "vwmy4ur-1";"`);
});

test('function with simple ternary expressions', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const theme = vindurFn(({ variant = 'primary', disabled = false }) => \`
      background: \${variant};
      opacity: \${disabled ? '0.5' : '1'};
    \`)
  `;

  const { code, css } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { theme } from './functions'

      const style = css\`
        \${theme({ variant: 'secondary', disabled: false })};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      background: secondary;
      opacity: 1;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "vwmy4ur-1";"`);
});

test('function with partial parameter override', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const card = vindurFn(({ 
      shadow = 'medium',
      radius = '8px',
      padding = '16px',
      bg = 'white'
    }) => \`
      background: \${bg};
      border-radius: \${radius};
      padding: \${padding};
      box-shadow: \${shadow};
    \`)
  `;

  const { code, css } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { card } from './functions'

      const style = css\`
        \${card({ shadow: 'large', bg: '#f8f9fa' })};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 16px;
      box-shadow: large;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "vwmy4ur-1";"`);
});

test('function with return statement syntax', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const transition = vindurFn((property: string, duration: number) => {
      return \`transition: \${property} \${duration}ms ease-in-out;\`;
    })
  `;

  const { code, css } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { transition } from './functions'

      const style = css\`
        \${transition('opacity', 300)};
        opacity: 0.5;
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      transition: opacity 300ms ease-in-out;
      opacity: 0.5;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "vwmy4ur-1";"`);
});

test('simple template literal in ternary', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const test = vindurFn((show: boolean, value?: number) => \`
      \${show ? \`display: block;\` : ''}
      \${value !== undefined ? \`width: \${value}px;\` : ''}
    \`)
  `;

  const { css } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { test } from './functions'

      const style = css\`
        \${test(true, 100)};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      display: block;
      width: 100px;
    }"
  `);
});

test('function optional parameters', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const spacing = vindurFn((margin: number, padding?: string | number) => {
      return \`margin: \${margin}px; \${padding ? \`padding: \${padding};\` : ''}\`;
    })
  `;

  const { code, css } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { spacing } from './functions'

      const style = css\`
        \${spacing(8)};
        color: blue;
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      margin: 8px;
      color: blue;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "vwmy4ur-1";"`);
});

test('function with multiple optional parameters', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const layout = vindurFn((width: number, height?: number, padding?: string) => \`
      width: \${width}px;
      \${height !== undefined ? \`height: \${height}px;\` : ''}
      \${padding !== undefined ? \`padding: \${padding};\` : ''}
    \`)
  `;

  // Test with all args
  const { css: css1 } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { layout } from './functions'

      const style = css\`
        \${layout(100, 200, '20px')};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css1).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      width: 100px;
      height: 200px;
      padding: 20px;
    }"
  `);

  // Test with some args
  const { css: css2 } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { layout } from './functions'

      const style = css\`
        \${layout(100, 200)};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css2).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      width: 100px;
      height: 200px;
    }"
  `);

  // Test with minimal args
  const { css: css3 } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { layout } from './functions'

      const style = css\`
        \${layout(100)};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css3).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      width: 100px;
    }"
  `);
});

test('function with all optional parameters', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const flex = vindurFn((direction?: string, gap?: number, wrap?: boolean) => \`
      display: flex;
      \${direction !== undefined ? \`flex-direction: \${direction};\` : ''}
      \${gap !== undefined ? \`gap: \${gap}px;\` : ''}
      \${wrap === true ? 'flex-wrap: wrap;' : ''}
    \`)
  `;

  // Test with no args
  const { css } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { flex } from './functions'

      const style = css\`
        \${flex()};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      display: flex;
    }"
  `);
});

test('function with optional boolean in ternary', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const visibility = vindurFn((show?: boolean, opacity?: number) => \`\${show === false ? 'display: none;' : ''}\${opacity !== undefined ? \`opacity: \${opacity};\` : ''}\`)
  `;

  // Test with show = false
  const { css: css1 } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { visibility } from './functions'

      const style = css\`
        \${visibility(false, 0.5)};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css1).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      display: none;opacity: 0.5;
    }"
  `);

  // Test with only opacity
  const { css: css2 } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { visibility } from './functions'

      const style = css\`
        \${visibility(undefined, 0.8)};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css2).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      opacity: 0.8;
    }"
  `);

  // Test with no args
  const { css: css3 } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { visibility } from './functions'

      const style = css\`
        \${visibility()};
        color: red;
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css3).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      color: red;
    }"
  `);
});

test('function with nested template in ternary', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const border = vindurFn((size: number, style?: string, color?: string) => \`
      \${style !== undefined ? \`border: \${size}px \${style} \${color !== undefined ? color : 'black'};\` : \`border-width: \${size}px;\`}
    \`)
  `;

  // Test with style and color
  const { css: css1 } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { border } from './functions'

      const style = css\`
        \${border(2, 'solid', 'red')};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css1).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      border: 2px solid red;
    }"
  `);

  // Test with style but no color (should use default)
  const { css: css2 } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { border } from './functions'

      const style = css\`
        \${border(3, 'dashed')};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css2).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      border: 3px dashed black;
    }"
  `);

  // Test without style (should use fallback)
  const { css: css3 } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { border } from './functions'

      const style = css\`
        \${border(4)};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css3).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      border-width: 4px;
    }"
  `);
});

test('destructured optional parameters', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const spacing = vindurFn(({ m, p, mx, my }: { m?: number; p?: number; mx?: number; my?: number }) => \`\${m !== undefined ? \`margin: \${m}px;\` : ''}\${p !== undefined ? \`padding: \${p}px;\` : ''}\${mx !== undefined ? \`margin-left: \${mx}px; margin-right: \${mx}px;\` : ''}\${my !== undefined ? \`margin-top: \${my}px; margin-bottom: \${my}px;\` : ''}\`)
  `;

  // Test with all params
  const { css: css1 } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { spacing } from './functions'

      const style = css\`
        \${spacing({ m: 10, p: 20, mx: 30, my: 40 })};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css1).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      margin: 10px;padding: 20px;margin-left: 30px; margin-right: 30px;margin-top: 40px; margin-bottom: 40px;
    }"
  `);

  // Test with some params
  const { css: css2 } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { spacing } from './functions'

      const style = css\`
        \${spacing({ p: 15, mx: 25 })};
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css2).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      padding: 15px;margin-left: 25px; margin-right: 25px;
    }"
  `);

  // Test with empty object
  const { css: css3 } = transform({
    fileAbsPath: '/test.ts',
    source: dedent`
      import { css } from 'vindur'
      import { spacing } from './functions'

      const style = css\`
        \${spacing({})};
        color: blue;
      \`
    `,
    fs: createFsMock({ 'functions.ts': fnFile }),
  });

  expect(css3).toMatchInlineSnapshot(`
    ".vwmy4ur-1 {
      color: blue;
    }"
  `);
});

describe('error handling', () => {
  test('function without vindurFn wrapper', () => {
    const fnFile = dedent`
      export const invalidFn = (size: number) => \`width: \${size}px\`
    `;

    expect(() => {
      transform({
        fileAbsPath: 'test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { invalidFn } from './functions'

          const style = css\`
            \${invalidFn(10)};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: called a invalid vindur function, style functions must be defined with "vindurFn(() => ...)" function]`,
    );
  });

  test('non-function export', () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const notAFunction = 'just a string'
    `;

    expect(() => {
      transform({
        fileAbsPath: 'test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { notAFunction } from './functions'

          const style = css\`
            \${notAFunction()};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: called a invalid vindur function, style functions must be defined with "vindurFn(() => ...)" function]`,
    );
  });

  test('vindurFn with non-function argument', () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const invalidWrapper = vindurFn('not a function')
    `;

    expect(() => {
      transform({
        fileAbsPath: 'test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { invalidWrapper } from './functions'

          const style = css\`
            \${invalidWrapper()};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn must be called with a function expression, got object in function "invalidWrapper"]`,
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
        fileAbsPath: 'test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { complexFn } from './functions'

          const style = css\`
            \${complexFn(50)};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "complexFn" body is too complex - functions must contain only a single return statement or be arrow functions with template literals]`,
    );
  });

  test('vindurFn with async function', () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const asyncFn = vindurFn(async (size: number) => \`width: \${size}px\`)
    `;

    expect(() => {
      transform({
        fileAbsPath: 'test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { asyncFn } from './functions'

          const style = css\`
            \${asyncFn(10)};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "asyncFn" cannot be async - functions must be synchronous for compile-time evaluation]`,
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
        fileAbsPath: 'test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { generatorFn } from './functions'

          const style = css\`
            \${generatorFn(10)};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "generatorFn" cannot be a generator function - functions must return simple template strings]`,
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
        fileAbsPath: 'test.ts',
        source: dedent`
          import { css } from 'vindur'
          import { externalFn } from './functions'

          const style = css\`
            \${externalFn(10)};
          \`
        `,
        fs: createFsMock({ 'functions.ts': fnFile }),
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: /Users/lucasoliveirasantos/Github/vindur/lib/test.ts: /Users/lucasoliveirasantos/Github/vindur/lib/functions.ts: vindurFn "externalFn" contains function calls which are not supported - functions must be self-contained]`,
    );
  });

});
