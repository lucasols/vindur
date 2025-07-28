import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transform } from '../../src/transform';
import { createFsMock } from '../testUtils';

const importAliases = { '#/': '/' };

describe('function evaluation - optional parameters', () => {
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
        import { spacing } from '#/functions'

        const style = css\`
          \${spacing(8)};
          color: blue;
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
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
        import { layout } from '#/functions'

        const style = css\`
          \${layout(100, 200, '20px')};
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
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
        import { layout } from '#/functions'

        const style = css\`
          \${layout(100, 200)};
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
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
        import { layout } from '#/functions'

        const style = css\`
          \${layout(100)};
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
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
        import { flex } from '#/functions'

        const style = css\`
          \${flex()};
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
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
        import { visibility } from '#/functions'

        const style = css\`
          \${visibility(false, 0.5)};
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
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
        import { visibility } from '#/functions'

        const style = css\`
          \${visibility(undefined, 0.8)};
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
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
        import { visibility } from '#/functions'

        const style = css\`
          \${visibility()};
          color: red;
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
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
        import { border } from '#/functions'

        const style = css\`
          \${border(2, 'solid', 'red')};
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
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
        import { border } from '#/functions'

        const style = css\`
          \${border(3, 'dashed')};
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
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
        import { border } from '#/functions'

        const style = css\`
          \${border(4)};
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
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
        import { spacing } from '#/functions'

        const style = css\`
          \${spacing({ m: 10, p: 20, mx: 30, my: 40 })};
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
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
        import { spacing } from '#/functions'

        const style = css\`
          \${spacing({ p: 15, mx: 25 })};
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
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
        import { spacing } from '#/functions'

        const style = css\`
          \${spacing({})};
          color: blue;
        \`
      `,
      fs: createFsMock({ 'functions.ts': fnFile }),
      importAliases,
    });

    expect(css3).toMatchInlineSnapshot(`
      ".vwmy4ur-1 {
        color: blue;
      }"
    `);
  });
});
