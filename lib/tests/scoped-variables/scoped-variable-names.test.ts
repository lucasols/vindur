import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/transform';
import { transformWithFormat } from '../testUtils';

test('should rename scoped names in selectors', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, createGlobalStyle } from 'vindur'

      const card = css\`
        view-transition-name: ---card;
        &[data-name=---card], &[data-name="---card"] {
          color: red;
        }
      \`

      createGlobalStyle\`
        ::view-transition-old(---card) {
          opacity: 0;
        }
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-card {
      view-transition-name: --v1560qbr-2-card;
      &[data-name="---card"],
      &[data-name="---card"] {
        color: red;
      }
    }

    ::view-transition-old(--v1560qbr-2-card) {
      opacity: 0;
    }
    "
  `);
});

test('should not reuse scoped variable indices across nested css props', async () => {
  const result = await transformWithFormat({
    source: dedent`
      const App = () => (
        <div css={\`---a: 1px; ---b: 2px; width: var(---a); height: var(---b);\`}>
          <span css={\`---c: 3px; margin: var(---c);\`} />
        </div>
      )
    `,
    production: true,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1 {
      --v1560qbr-2: 1px;
      --v1560qbr-3: 2px;
      width: var(--v1560qbr-2);
      height: var(--v1560qbr-3);
    }

    .v1560qbr-4 {
      --v1560qbr-5: 3px;
      margin: var(--v1560qbr-5);
    }
    "
  `);
});

test('should rename quoted keyframes names like their uses', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createGlobalStyle } from 'vindur'

      createGlobalStyle\`
        @keyframes "---spin" {
          to {
            rotate: 1turn;
          }
        }

        .spinner {
          animation: ---spin 1s;
        }
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    "@keyframes "--v1560qbr-2-spin" {
      to {
        rotate: 1turn;
      }
    }

    .spinner {
      animation: --v1560qbr-2-spin 1s;
    }
    "
  `);
});

test('should rename quoted keyframes names in animations', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, createGlobalStyle } from 'vindur'

      createGlobalStyle\`
        @keyframes "---spin" {
          to { rotate: 1turn; }
        }
      \`

      const spinner = css\`
        animation: "---spin" 1s;
        content: "---spin";
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    "@keyframes "--v1560qbr-2-spin" {
      to {
        rotate: 1turn;
      }
    }

    .v1560qbr-3-spinner {
      animation: "--v1560qbr-2-spin" 1s;
      content: "---spin";
    }
    "
  `);
});

test('should treat registered properties as declared', async () => {
  const warnings: TransformWarning[] = [];

  await transformWithFormat({
    source: dedent`
      import { css, createGlobalStyle } from 'vindur'

      createGlobalStyle\`
        @property ---angle {
          syntax: '<angle>';
          inherits: false;
          initial-value: 0deg;
        }
      \`

      const style = css\`
        rotate: var(---angle);
      \`
    `,
    onWarning: (warning) => warnings.push(warning),
  });

  expect(warnings).toEqual([]);
});

test('should rename quoted grid areas, font families and nested animation names', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, createGlobalStyle } from 'vindur'

      createGlobalStyle\`
        @font-face { font-family: "---brand"; src: url(brand.woff2); }
        @keyframes "---spin" { to { rotate: 1turn; } }
      \`

      const layout = css\`
        font-family: ---brand, sans-serif;
        grid-template-areas: "---head ---head" ". ---side";
        animation: var(--animation, "---spin" 1s);
        -webkit-animation-name: "---spin";

        & > header { grid-area: ---head; }
        & > nav { grid-area: ---side; }
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    "@font-face {
      font-family: "--v1560qbr-2-brand";
      src: url(brand.woff2);
    }
    @keyframes "--v1560qbr-3-spin" {
      to {
        rotate: 1turn;
      }
    }

    .v1560qbr-4-layout {
      font-family: --v1560qbr-2-brand, sans-serif;
      grid-template-areas: "--v1560qbr-5-head --v1560qbr-5-head" ". --v1560qbr-6-side";
      animation: var(--animation, "--v1560qbr-3-spin" 1s);
      -webkit-animation-name: "--v1560qbr-3-spin";

      & > header {
        grid-area: --v1560qbr-5-head;
      }
      & > nav {
        grid-area: --v1560qbr-6-side;
      }
    }
    "
  `);
});

test('should rename quoted scoped names in the font shorthand', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createGlobalStyle } from 'vindur'

      createGlobalStyle\`
        @font-face {
          font-family: "---brand";
          src: url(brand.woff2);
        }

        body {
          font: italic 16px "---brand", serif;
        }
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    "@font-face {
      font-family: "--v1560qbr-2-brand";
      src: url(brand.woff2);
    }

    body {
      font:
        italic 16px "--v1560qbr-2-brand",
        serif;
    }
    "
  `);
});

test('should throw for quoted scoped names that are not renamed', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        export const spin = css\`
          ---anim: "---spin" 1s;
          animation: var(---anim);
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Quoted scoped names are not supported in custom properties, write \`---spin\` without quotes
    loc: 4:11]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          @font-feature-values "---brand" {
            @swash { fancy: 1; }
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped CSS variables are not supported in \`@font-feature-values\` rule preludes
    loc: 4:23]
  `);
});
