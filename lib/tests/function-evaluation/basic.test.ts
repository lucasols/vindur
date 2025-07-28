import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('function evaluation - basic functionality', () => {
  test('function with simple params', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const pixelSize = vindurFn((size: number) => '\${size}px')
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { pixelSize } from '#/functions'

        const style = css\`
          width: \${pixelSize(10)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        width: 10px;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function with multiple params', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const margin = vindurFn((top: number, right: number, bottom: number, left: number) => \`
        margin: \${top}px \${right}px \${bottom}px \${left}px;
      \`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { margin } from '#/functions'

        const style = css\`
          \${margin(10, 20, 30, 40)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        margin: 10px 20px 30px 40px;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function with destructured object param', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const inline = vindurFn(({ justify = 'left', align = 'center', gap }) => \`
        display: flex;
        justify-content: \${justify === 'left' ? 'flex-start' : justify === 'right' ? 'flex-end' : 'center'};
        align-items: \${align === 'center' ? 'center' : 'flex-end'};
        gap: \${gap}px;
      \`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { inline } from '#/functions'

        const style = css\`
          \${inline({ gap: 10 })};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        gap: 10px;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function with no parameters', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const reset = vindurFn(() => \`
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      \`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { reset } from '#/functions'

        const style = css\`
          \${reset()};
          color: red;
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        color: red;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function returning static string', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const border = vindurFn(() => '1px solid black')
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { border } from '#/functions'

        const style = css\`
          border: \${border()};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        border: 1px solid black;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function with simple conditional', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const spacing = vindurFn(({ size = 'medium' }) => \`
        padding: \${size};
      \`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { spacing } from '#/functions'

        const style = css\`
          \${spacing({ size: 'large' })};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        padding: large;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('multiple functions in one file', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const px = vindurFn((size: number) => '\${size}px')
      export const percent = vindurFn((value: number) => '\${value}%')
      export const color = vindurFn((name: string) => '\${name}')
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { px, percent, color } from '#/functions'

        const style = css\`
          font-size: \${px(24)};
          width: \${percent(50)};
          background: \${color('red')};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        font-size: 24px;
        width: 50%;
        background: red;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function with mixed parameter types', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const shadow = vindurFn((x: number, y: number, blur: number, color: string) => '\${x}px \${y}px \${blur}px \${color}')
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { shadow } from '#/functions'

        const style = css\`
          box-shadow: \${shadow(2, 4, 8, 'rgba(0,0,0,0.3)')};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        box-shadow: 2px 4px 8px rgba(0,0,0,0.3);
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function with all default values used', async () => {
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

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { button } from '#/functions'

        const style = css\`
          \${button({})};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        background: blue;
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        border: none;
        cursor: pointer;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function with simple interpolation', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const grid = vindurFn((cols: number, gap: number) => \`
        display: grid;
        grid-template-columns: repeat(\${cols}, 1fr);
        gap: \${gap}px;
      \`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { grid } from '#/functions'

        const style = css\`
          \${grid(3, 16)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function with simple ternary expressions', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const theme = vindurFn(({ variant = 'primary', disabled = false }) => \`
        background: \${variant};
        opacity: \${disabled ? '0.5' : '1'};
      \`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { theme } from '#/functions'

        const style = css\`
          \${theme({ variant: 'secondary', disabled: false })};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        background: secondary;
        opacity: 1;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function with partial parameter override', async () => {
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

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { card } from '#/functions'

        const style = css\`
          \${card({ shadow: 'large', bg: '#f8f9fa' })};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        background: #f8f9fa;
        border-radius: 8px;
        padding: 16px;
        box-shadow: large;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function with return statement syntax', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const transition = vindurFn((property: string, duration: number) => {
        return \`transition: \${property} \${duration}ms ease-in-out;\`;
      })
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { transition } from '#/functions'

        const style = css\`
          \${transition('opacity', 300)};
          opacity: 0.5;
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        transition: opacity 300ms ease-in-out;
        opacity: 0.5;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('simple template literal in ternary', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const test = vindurFn((show: boolean, value?: number) => \`
        \${show ? \`display: block;\` : ''}
        \${value !== undefined ? \`width: \${value}px;\` : ''}
      \`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { test } from '#/functions'

        const style = css\`
          \${test(true, 100)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        display: block;
        width: 100px;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });
});
