import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from './testUtils';

const importAliases = { '#/': '/' };
const emptyFs = createFsMock({});

describe('createGlobalStyle', () => {
  test('should create global styles without class wrapper', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          body {
            margin: 0;
            font-family: Arial, sans-serif;
          }
  
          * {
            box-sizing: border-box;
          }
        \`
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      "body {
          margin: 0;
          font-family: Arial, sans-serif;
        }

        * {
          box-sizing: border-box;
        }"
    `);
  });

  test('should handle inline createGlobalStyle usage', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          h1 {
            color: blue;
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      "h1 {
          color: blue;
        }"
    `);
  });

  test('should support interpolation with variables', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        const primaryColor = 'red';
        const fontSize = 16;

        createGlobalStyle\`
          body {
            color: \${primaryColor};
            font-size: \${fontSize}px;
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const primaryColor = "red";
      const fontSize = 16;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      "body {
          color: red;
          font-size: 16px;
        }"
    `);
  });

  test('should support interpolation with styled component references', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createGlobalStyle, styled } from 'vindur'

        const Button = styled.button\`
          padding: 10px;
        \`

        createGlobalStyle\`
          .button-base {
            margin: 5px;
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 10px;
      }

      .button-base {
          margin: 5px;
        }"
    `);
  });

  test('should support interpolation with CSS variable references', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createGlobalStyle, css } from 'vindur'

        const baseStyles = css\`
          padding: 10px;
        \`

        createGlobalStyle\`
          .custom-styles {
            margin: 5px;
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const baseStyles = "v1560qbr-1-baseStyles";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-baseStyles {
        padding: 10px;
      }

      .custom-styles {
          margin: 5px;
        }"
    `);
  });

  test('should support multiple global style blocks', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          body {
            margin: 0;
          }
        \`

        createGlobalStyle\`
          h1 {
            color: blue;
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      "body {
          margin: 0;
        }

      h1 {
          color: blue;
        }"
    `);
  });

  test('should support vindur functions in global styles', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const spacing = vindurFn((multiplier: number) => \`\${multiplier * 8}px\`)
      export const systemFont = vindurFn(() => \`system-ui, -apple-system, BlinkMacSystemFont, sans-serif\`)
      export const monoFont = vindurFn(() => \`Monaco, Consolas, monospace\`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'
        import { spacing, systemFont, monoFont } from '#/functions'

        createGlobalStyle\`
          body {
            margin: \${spacing(0)};
            padding: \${spacing(2)};
            font-family: \${systemFont()};
          }

          code {
            font-family: \${monoFont()};
            padding: \${spacing(1)};
          }
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      "body {
          margin: 0px;
          padding: 16px;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        }

        code {
          font-family: Monaco, Consolas, monospace;
          padding: 8px;
        }"
    `);
  });

  test('should support complex function compositions in global styles', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const mediumBreakpoint = vindurFn(() => \`768px\`)
      export const largeBreakpoint = vindurFn(() => \`1024px\`)
      export const modalZIndex = vindurFn(() => \`1000\`)
      export const dropdownZIndex = vindurFn(() => \`100\`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'
        import { mediumBreakpoint, largeBreakpoint, modalZIndex, dropdownZIndex } from '#/functions'

        createGlobalStyle\`
          .modal-overlay {
            z-index: \${modalZIndex()};
          }

          .dropdown {
            z-index: \${dropdownZIndex()};
          }

          @media (min-width: \${mediumBreakpoint()}) {
            .container {
              max-width: 768px;
              margin: 0 auto;
            }
          }

          @media (min-width: \${largeBreakpoint()}) {
            .container {
              max-width: 1024px;
            }
          }
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      ".modal-overlay {
          z-index: 1000;
        }

        .dropdown {
          z-index: 100;
        }

        @media (min-width: 768px) {
          .container {
            max-width: 768px;
            margin: 0 auto;
          }
        }

        @media (min-width: 1024px) {
          .container {
            max-width: 1024px;
          }
        }"
    `);
  });

  test('should support functions mixed with regular interpolation', async () => {
    const fnFile = dedent`
      import { vindurFn } from 'vindur'

      export const rem = vindurFn((px: number) => \`\${px / 16}rem\`)
    `;

    const result = await transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'
        import { rem } from '#/functions'

        const primaryColor = '#007bff';
        const maxWidth = 1200;

        createGlobalStyle\`
          :root {
            --primary-color: \${primaryColor};
            --container-max-width: \${maxWidth}px;
          }

          html {
            font-size: \${rem(16)};
          }

          h1 {
            font-size: \${rem(32)};
            color: var(--primary-color);
          }

          .container {
            max-width: var(--container-max-width);
            padding: \${rem(24)};
          }
        \`
      `,
      overrideDefaultFs: createFsMock({ 'functions.ts': fnFile }),
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const primaryColor = "#007bff";
      const maxWidth = 1200;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ":root {
          --primary-color: #007bff;
          --container-max-width: 1200px;
        }

        html {
          font-size: 1rem;
        }

        h1 {
          font-size: 2rem;
          color: var(--primary-color);
        }

        .container {
          max-width: var(--container-max-width);
          padding: 1.5rem;
        }"
    `);
  });
});
