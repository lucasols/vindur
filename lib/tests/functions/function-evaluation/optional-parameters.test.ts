import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../../testUtils';

describe('function evaluation - optional parameters', () => {
  test('function optional parameters', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const spacing = vindurFn((margin: number, padding?: string | number) => {
        return \`margin: \${margin}px; \${padding ? \`padding: \${padding};\` : ''}\`;
      })
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { spacing } from '#/functions'

        const style = css\`
          \${spacing(8)};
          color: blue;
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        margin: 8px;
        color: blue;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const style = "v1560qbr-1-style";
      "
    `);
  });

  test('function with multiple optional parameters', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const layout = vindurFn((width: number, height?: number, padding?: string) => \`
        width: \${width}px;
        \${height !== undefined ? \`height: \${height}px;\` : ''}
        \${padding !== undefined ? \`padding: \${padding};\` : ''}
      \`)
    `;

    // Test with all args
    const result1 = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { layout } from '#/functions'

        const style = css\`
          \${layout(100, 200, '20px')};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result1.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        width: 100px;
        height: 200px;
        padding: 20px;
      }"
    `);

    // Test with some args
    const result2 = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { layout } from '#/functions'

        const style = css\`
          \${layout(100, 200)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result2.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        width: 100px;
        height: 200px;
      }"
    `);

    // Test with minimal args
    const result3 = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { layout } from '#/functions'

        const style = css\`
          \${layout(100)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result3.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        width: 100px;
      }"
    `);
  });

  test('function with all optional parameters', async () => {
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
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { flex } from '#/functions'

        const style = css\`
          \${flex()};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        display: flex;
      }"
    `);
  });

  test('function with optional boolean in ternary', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const visibility = vindurFn((show?: boolean, opacity?: number) => \`\${show === false ? 'display: none;' : ''}\${opacity !== undefined ? \`opacity: \${opacity};\` : ''}\`)
    `;

    // Test with show = false
    const result1 = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { visibility } from '#/functions'

        const style = css\`
          \${visibility(false, 0.5)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result1.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        display: none;opacity: 0.5;
      }"
    `);

    // Test with only opacity
    const result2 = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { visibility } from '#/functions'

        const style = css\`
          \${visibility(undefined, 0.8)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result2.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        opacity: 0.8;
      }"
    `);

    // Test with no args
    const result3 = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { visibility } from '#/functions'

        const style = css\`
          \${visibility()};
          color: red;
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result3.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        color: red;
      }"
    `);
  });

  test('function with nested template in ternary', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const border = vindurFn((size: number, style?: string, color?: string) => \`
        \${style !== undefined ? \`border: \${size}px \${style} \${color !== undefined ? color : 'black'};\` : \`border-width: \${size}px;\`}
      \`)
    `;

    // Test with style and color
    const result1 = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { border } from '#/functions'

        const style = css\`
          \${border(2, 'solid', 'red')};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result1.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        border: 2px solid red;
      }"
    `);

    // Test with style but no color (should use default)
    const result2 = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { border } from '#/functions'

        const style = css\`
          \${border(3, 'dashed')};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result2.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        border: 3px dashed black;
      }"
    `);

    // Test without style (should use fallback)
    const result3 = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { border } from '#/functions'

        const style = css\`
          \${border(4)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result3.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        border-width: 4px;
      }"
    `);
  });

  test('destructured optional parameters', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const spacing = vindurFn(({ m, p, mx, my }: { m?: number; p?: number; mx?: number; my?: number }) => \`\${m !== undefined ? \`margin: \${m}px;\` : ''}\${p !== undefined ? \`padding: \${p}px;\` : ''}\${mx !== undefined ? \`margin-left: \${mx}px; margin-right: \${mx}px;\` : ''}\${my !== undefined ? \`margin-top: \${my}px; margin-bottom: \${my}px;\` : ''}\`)
    `;

    // Test with all params
    const result1 = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { spacing } from '#/functions'

        const style = css\`
          \${spacing({ m: 10, p: 20, mx: 30, my: 40 })};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result1.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        margin: 10px;padding: 20px;margin-left: 30px; margin-right: 30px;margin-top: 40px; margin-bottom: 40px;
      }"
    `);

    // Test with some params
    const result2 = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { spacing } from '#/functions'

        const style = css\`
          \${spacing({ p: 15, mx: 25 })};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result2.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        padding: 15px;margin-left: 25px; margin-right: 25px;
      }"
    `);

    // Test with empty object
    const result3 = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { spacing } from '#/functions'

        const style = css\`
          \${spacing({})};
          color: blue;
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result3.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style {
        color: blue;
      }"
    `);
  });
});
