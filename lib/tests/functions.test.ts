import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transform } from '../src/transform';
import { createFsMock } from './testUtils';

test('function with simple params', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const pixelSize = vindurFn((size: number) => '\${size}px')
  `;

  const source = dedent`
    import { css } from 'vindur'
    import { pixelSize } from './functions'

    const style = css\`
      width: \${pixelSize(10)};
    \`
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile, '/test.ts': source }),
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

  const source = dedent`
    import { css } from 'vindur'
    import { margin } from './functions'

    const style = css\`
      \${margin(10, 20, 30, 40)};
    \`
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile, '/test.ts': source }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      margin: 10px 20px 30px 40px;
    ;
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

  const source = dedent`
    import { css } from 'vindur'
    import { inline } from './functions'

    const style = css\`
      \${inline({ gap: 10 })};
    \`
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      display: flex;
      justify-content: ;
      align-items: center;
      gap: 10px;
    ;
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

  const source = dedent`
    import { css } from 'vindur'
    import { reset } from './functions'

    const style = css\`
      \${reset()};
      color: red;
    \`
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile, '/test.ts': source }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    ;
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

  const source = dedent`
    import { css } from 'vindur'
    import { border } from './functions'

    const style = css\`
      border: \${border()};
    \`
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile, '/test.ts': source }),
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

  const source = dedent`
    import { css } from 'vindur'
    import { spacing } from './functions'

    const style = css\`
      \${spacing({ size: 'large' })};
    \`
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile, '/test.ts': source }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      padding: large;
    ;
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

  const source = dedent`
    import { css } from 'vindur'
    import { px, percent, color } from './functions'

    const style = css\`
      font-size: \${px(24)};
      width: \${percent(50)};
      background: \${color('red')};
    \`
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile, '/test.ts': source }),
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

  const source = dedent`
    import { css } from 'vindur'
    import { shadow } from './functions'

    const style = css\`
      box-shadow: \${shadow(2, 4, 8, 'rgba(0,0,0,0.3)')};
    \`
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile, '/test.ts': source }),
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

  const source = dedent`
    import { css } from 'vindur'
    import { button } from './functions'

    const style = css\`
      \${button({})};
    \`
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile, '/test.ts': source }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      background: blue;
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
    ;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
});

test('error handling - missing function file', () => {
  const source = dedent`
    import { css } from 'vindur'
    import { nonExistent } from './missing'

    const style = css\`
      color: \${nonExistent()};
    \`
  `;

  expect(() => {
    transform({
      fileAbsPath: 'test.ts',
      source,
      fs: createFsMock({ '/test.ts': source }),
    });
  }).toThrowErrorMatchingInlineSnapshot(
    `[Error: unknown file: File not found: ./missing.ts]`,
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

  const source = dedent`
    import { css } from 'vindur'
    import { grid } from './functions'

    const style = css\`
      \${grid(3, 16)};
    \`
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile, '/test.ts': source }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    ;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
});

test('function with simple ternary expressions', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const theme = vindurFn(({ variant = 'primary', disabled = false }) => \`
      background: \${variant};
      opacity: \${disabled ? '0.5' : '1'};
    \`)
  `;

  const source = dedent`
    import { css } from 'vindur'
    import { theme } from './functions'

    const style = css\`
      \${theme({ variant: 'secondary', disabled: false })};
    \`
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile, '/test.ts': source }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      background: secondary;
      opacity: 1;
    ;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
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

  const source = dedent`
    import { css } from 'vindur'
    import { card } from './functions'

    const style = css\`
      \${card({ shadow: 'large', bg: '#f8f9fa' })};
    \`
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile, '/test.ts': source }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 16px;
      box-shadow: large;
    ;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
});

test('function with return statement syntax', () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur'

    export const transition = vindurFn((property: string, duration: number) => {
      return \`transition: \${property} \${duration}ms ease-in-out;\`;
    })
  `;

  const source = dedent`
    import { css } from 'vindur'
    import { transition } from './functions'

    const style = css\`
      \${transition('opacity', 300)};
      opacity: 0.5;
    \`
  `;

  const { code, css } = transform({
    fileAbsPath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile, '/test.ts': source }),
  });

  expect(css).toMatchInlineSnapshot(`
    ".v196xm6g-1 {
      transition: opacity 300ms ease-in-out;;
      opacity: 0.5;
    }"
  `);
  expect(code).toMatchInlineSnapshot(`"const style = "v196xm6g-1";"`);
});
