import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

test('should fail on colors interpolated without a CSS value', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createStaticThemeColors, css } from 'vindur'

        const colors = createStaticThemeColors({ primary: '#007bff' })

        export const a = css\`
          color: \${colors.primary};
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... a = css\` ... \${colors.primary}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
    loc: 6:11]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { createDynamicCssColor, styled } from 'vindur'

        const color = createDynamicCssColor()

        export const A = styled.div\`
          \${color.self} {
            color: red;
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... A = styled\` ... \${color.self}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
    loc: 6:4]
  `);
});

test('should accept imported constant options for contrast.optimal', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor, createStaticThemeColors, css } from 'vindur'
      import { OPTIONS } from '#/options'

      const color = createDynamicCssColor()
      const colors = createStaticThemeColors({ primary: '#007bff' })

      export const a = css\`
        color: \${color.contrast.optimal(OPTIONS)};
        background: \${colors.primary.contrast.optimal(OPTIONS)};
      \`
    `,
    overrideDefaultFs: createFsMock({
      'options.ts': dedent`
        export const OPTIONS = { alpha: 0.5 }
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, createStaticThemeColors } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    const colors = createStaticThemeColors({
      primary: "#007bff",
    });
    export const a = "v1560qbr-2-a";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2-a {
      color: color-mix(in srgb, var(--v1560qbr-1-color-c-optimal) 50%, transparent);
      background: var(--stc-primary-contrast-optimal-0\\.5, #ffffff80);
    }
    "
  `);
});

test('should replace characters invalid in CSS in theme color variable names', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createStaticThemeColors, css } from 'vindur'

      const colors = createStaticThemeColors({ $brand: '#3366cc' })

      export const a = css\`
        color: \${colors.$brand.var};
        background: \${colors.$brand.contrast.var};
        border-color: \${colors.$brand.darker(0.1)};
      \`
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createStaticThemeColors } from "vindur";
    const colors = createStaticThemeColors({
      $brand: "#3366cc",
    });
    export const a = "v1560qbr-1-a";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-a {
      color: var(--stc-_brand-var, #36c);
      background: var(--stc-_brand-contrast-var, #fff);
      border-color: var(--stc-_brand-darker-0\\.1, #2e5cb8);
    }
    "
  `);
});

test('should throw when a container selector starts a compound selector without &', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createDynamicCssColor, styled } from 'vindur'

        const color = createDynamicCssColor()

        export const A = styled.div\`
          \${color.container.isDark}:hover {
            color: red;
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`\${color.container.isDark}\` matches an ancestor that sets the color. Use \`\${color.container.isDark} & { ... }\` to style this element, or \`& \${color.container.isDark} { ... }\` to style descendants that set the color
    loc: 6:4]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { createDynamicCssColor, styled } from 'vindur'

        const color = createDynamicCssColor()

        export const A = styled.div\`
          \${(color.container.isDark)} /* dark */ {
            color: red;
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`\${(color.container.isDark)}\` matches an ancestor that sets the color. Use \`\${(color.container.isDark)} & { ... }\` to style this element, or \`& \${(color.container.isDark)} { ... }\` to style descendants that set the color
    loc: 6:4]
  `);
});

test('should allow a container selector followed by a descendant selector', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      export const A = styled.div\`
        \${color.container.isDark} .icon {
          color: red;
        }
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2-A {
      .v1560qbr-1-color-container-isDark .icon {
        color: red;
      }
    }
    "
  `);
});
