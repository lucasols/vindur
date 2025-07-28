import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('variable references in function calls', () => {
  test('function call with simple variable reference', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const pixelSize = vindurFn((size: number) => 'width: \${size}px;')
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { pixelSize } from '#/functions'

        const mySize = 24

        const style = css\`
          \${pixelSize(mySize)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vwmy4ur-1 {
        width: 24px;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const mySize = 24;
      const style = "vwmy4ur-1";"
    `);
  });

  test('function call with arithmetic using variables', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const spacing = vindurFn((margin: number, padding: number) => \`
        margin: \${margin}px;
        padding: \${padding}px;
      \`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { spacing } from '#/functions'

        const baseUnit = 8
        const scale = 2

        const style = css\`
          \${spacing(baseUnit * scale, baseUnit)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vwmy4ur-1 {
        margin: 16px;
        padding: 8px;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const baseUnit = 8;
      const scale = 2;
      const style = "vwmy4ur-1";"
    `);
  });

  test('function call with string variable', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const colorize = vindurFn((color: string) => 'color: \${color};')
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { colorize } from '#/functions'

        const primaryColor = 'blue'

        const style = css\`
          \${colorize(primaryColor)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vwmy4ur-1 {
        color: blue;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const primaryColor = 'blue';
      const style = "vwmy4ur-1";"
    `);
  });

  test('function call with multiple variable references', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const border = vindurFn((width: number, style: string, color: string) => \`
        border: \${width}px \${style} \${color};
      \`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { border } from '#/functions'

        const borderWidth = 2
        const borderStyle = 'solid'
        const borderColor = 'red'

        const style = css\`
          \${border(borderWidth, borderStyle, borderColor)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vwmy4ur-1 {
        border: 2px solid red;
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const borderWidth = 2;
      const borderStyle = 'solid';
      const borderColor = 'red';
      const style = "vwmy4ur-1";"
    `);
  });

  test('function call with template literal variable', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const content = vindurFn((text: string) => 'content: "\${text}";')
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { content } from '#/functions'

        const prefix = 'Hello'
        const suffix = 'World'
        const message = \`\${prefix} \${suffix}\`

        const style = css\`
          \${content(message)};
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vwmy4ur-1 {
        content: "Hello World";
      }"
    `);
    expect(result.code).toMatchInlineSnapshot(`
      "const prefix = 'Hello';
      const suffix = 'World';
      const message = \`\${prefix} \${suffix}\`;
      const style = "vwmy4ur-1";"
    `);
  });
});
