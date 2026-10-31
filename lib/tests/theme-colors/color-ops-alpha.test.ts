import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

const colorsSource = (styles: string) => dedent`
  import { createDynamicCssColor, createStaticThemeColors, css } from 'vindur'

  const color = createDynamicCssColor()
  const colors = createStaticThemeColors({ primary: '#007bff' })

  export const style = css\`
    ${styles}
  \`
`;

const alphaStyles = dedent`
  --darker: \${color.darker(0.1, 0.5)};
  --lighter: \${color.lighter(0.3, 0.08)};
  --saturated-darker: \${color.saturatedDarker(0.86, 0.36)};
  --static-darker: \${colors.primary.darker(0.1, 0.5)};
  --static-lighter: \${colors.primary.lighter(0.3, 0.08)};
  --static-saturated-darker: \${colors.primary.saturatedDarker(0.86, 0.36)};
`;

test('should apply the alpha of darker, lighter and saturatedDarker', async () => {
  const result = await transformWithFormat({
    source: colorsSource(alphaStyles),
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2-style {
      --darker: color-mix(
        in srgb,
        color-mix(in srgb, var(--v1560qbr-1-color) 90%, #000) 50%,
        transparent
      );
      --lighter: color-mix(
        in srgb,
        color-mix(in srgb, var(--v1560qbr-1-color) 70%, #fff) 8%,
        transparent
      );
      --saturated-darker: color-mix(
        in srgb,
        hsl(
            var(--v1560qbr-1-color-h),
            var(--v1560qbr-1-color-sds),
            calc(var(--v1560qbr-1-color-l) * 0.14)
          )
          36%,
        transparent
      );
      --static-darker: var(--stc-primary-darker-0\\.1-alpha-0\\.5, #006fe680);
      --static-lighter: var(--stc-primary-lighter-0\\.3-alpha-0\\.08, #4da3ff14);
      --static-saturated-darker: var(
        --stc-primary-saturatedDarker-0\\.86-alpha-0\\.36,
        #0011245c
      );
    }
    "
  `);
});

test('should compute the static alpha hex in production', async () => {
  const result = await transformWithFormat({
    source: colorsSource(alphaStyles),
    production: true,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2 {
      --darker: color-mix(
        in srgb,
        color-mix(in srgb, var(--v1560qbr-1) 90%, #000) 50%,
        transparent
      );
      --lighter: color-mix(
        in srgb,
        color-mix(in srgb, var(--v1560qbr-1) 70%, #fff) 8%,
        transparent
      );
      --saturated-darker: color-mix(
        in srgb,
        hsl(
            var(--v1560qbr-1-h),
            var(--v1560qbr-1-sds),
            calc(var(--v1560qbr-1-l) * 0.14)
          )
          36%,
        transparent
      );
      --static-darker: #006fe680;
      --static-lighter: #4da3ff14;
      --static-saturated-darker: #0011245c;
    }
    "
  `);
});

test('should validate the alpha of color methods', async () => {
  await expect(
    transformWithFormat({
      source: colorsSource('color: ${color.darker(0.1, 2)};'),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Method darker alpha must be between 0 and 1, got 2
    loc: 7:11]
  `);

  await expect(
    transformWithFormat({
      source: colorsSource(
        'color: ${colors.primary.saturatedDarker(0.5, -0.1)};',
      ),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Method saturatedDarker alpha must be between 0 and 1, got -0.1
    loc: 7:11]
  `);
});
