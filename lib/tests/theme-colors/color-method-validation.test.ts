import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

const colorsSource = (styles: string) => dedent`
  import { createDynamicCssColor, createStaticThemeColors, css } from 'vindur'

  const color = createDynamicCssColor()
  const colors = createStaticThemeColors({ primary: '#007bff' })

  export const style = css\`
    color: ${styles};
  \`
`;

test('should validate the options of contrast.optimal', async () => {
  await expect(
    transformWithFormat({
      source: colorsSource('${color.contrast.optimal({ alpha: 2 })}'),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Method optimal alpha must be between 0 and 1, got 2
    loc: 7:11]
  `);

  await expect(
    transformWithFormat({
      source: colorsSource('${colors.primary.contrast.optimal({ alpha: 2 })}'),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Method optimal alpha must be between 0 and 1, got 2
    loc: 7:11]
  `);
});

test('should validate color method amounts in parentheses and constants', async () => {
  await expect(
    transformWithFormat({ source: colorsSource('${(color.darker(2))}') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Method darker amount must be between 0 and 1, got 2
    loc: 7:12]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { createDynamicCssColor, css } from 'vindur'

        const color = createDynamicCssColor()
        const HOVER = color.darker(2)

        export const style = css\`
          color: \${HOVER};
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... style = css\` ... \${HOVER}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
    loc: 7:11
    ignoreInLint: true]
  `);
});

test('should throw when an imported value could not be evaluated in its module', async () => {
  const source = (interpolation: string) => dedent`
    import { css } from 'vindur'
    import { hover, random } from '#/colors'

    export const style = css\`
      color: \${${interpolation}};
    \`
  `;
  const overrideDefaultFs = createFsMock({
    'colors.ts': dedent`
      import { createDynamicCssColor } from 'vindur'

      export const color = createDynamicCssColor()
      export const hover = color.darker(0.2)
      export const random = Math.random()
    `,
  });

  await expect(
    transformWithFormat({ source: source('hover'), overrideDefaultFs }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "hover" imported from /colors.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated
    loc: 5:11]
  `);

  await expect(
    transformWithFormat({ source: source('`${random}px`'), overrideDefaultFs }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid interpolation used at \`... style = css\` ... \${\`\${random}px\`}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
    loc: 5:11]
  `);
});
