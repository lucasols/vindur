import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../../testUtils';

test('should join with commas when the separator is undefined in vindurFn', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { fontFamily } from '#/functions';
      import { FONTS } from '#/constants';

      const style = css\`
        \${fontFamily(FONTS)};
      \`;
    `,
    overrideDefaultFs: createFsMock({
      'functions.ts': dedent`
        import { vindurFn } from 'vindur';

        export const fontFamily = vindurFn((families: string[], separator?: string) => \`font-family: \${families.join(separator)};\`);
      `,
      'constants.ts': dedent`
        export const FONTS = ['Arial', 'sans-serif'];
      `,
    }),
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      font-family: Arial, sans-serif;
    }
    "
  `);
});

test('should compare an array parameter with undefined in vindurFn', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { classes } from '#/functions';

      const style = css\`
        \${classes(['a', 'b'])};
        \${classes()};
      \`;
    `,
    overrideDefaultFs: createFsMock({
      'functions.ts': dedent`
        import { vindurFn } from 'vindur';

        export const classes = vindurFn((values?: string[]) => values === undefined ? '--empty: 1' : \`--values: \${values.join(' ')}\`);
      `,
    }),
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      --values: a b;
      --empty: 1;
    }
    "
  `);
});

test('should evaluate negative, template and member arguments in vindurFn', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { spacing, margin } from '#/functions';

      const sizes = { small: '4px' };

      const style = css\`
        \${spacing(-4)};
        \${margin(\`\${2 * 4}px\`)};
        \${margin(sizes.small)};
      \`;
    `,
    overrideDefaultFs: createFsMock({
      'functions.ts': dedent`
        import { vindurFn } from 'vindur';

        export const spacing = vindurFn((n: number) => \`padding: \${n}px;\`);
        export const margin = vindurFn((value: string) => \`margin: \${value};\`);
      `,
    }),
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      padding: -4px;
      margin: 8px;
      margin: 4px;
    }
    "
  `);
});
