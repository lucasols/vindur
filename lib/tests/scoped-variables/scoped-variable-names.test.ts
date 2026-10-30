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

test('should rename quoted font families and nested animation names', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, createGlobalStyle } from 'vindur'

      createGlobalStyle\`
        @font-face { font-family: "---brand"; src: url(brand.woff2); }
        @keyframes "---spin" { to { rotate: 1turn; } }
      \`

      const layout = css\`
        font-family: ---brand, sans-serif;
        animation: var(--animation, "---spin" 1s);
        -webkit-animation-name: "---spin";
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
      animation: var(--animation, "--v1560qbr-3-spin" 1s);
      -webkit-animation-name: "--v1560qbr-3-spin";
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
    [TransformError: /test.tsx: Quoted scoped names are not supported in custom properties, write \`---spin\` without quotes or the string directly in the property that uses it
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

test('should throw for quoted scoped names in custom property area strings and style queries', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        export const grid = css\`
          ---areas: "---head ---tail";
          grid-template-areas: var(---areas);
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Quoted scoped names are not supported in custom properties, write \`---head\` without quotes or the string directly in the property that uses it
    loc: 4:12]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        export const font = css\`
          font-family: if(style(--mode: "---serif"): serif; else: sans-serif);
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Quoted scoped names are not supported in custom properties, write \`---serif\` without quotes or the string directly in the property that uses it
    loc: 4:32]
  `);
});

test('should throw for scoped names in grid area strings', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        export const layout = css\`
          grid-template-areas: "---head ---head" ". side";
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped names are not supported in grid area strings, write \`head\` as a plain name, area names are already local to their grid container
    loc: 4:23]
  `);
});

test('should throw for uppercase scoped font family names', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          @font-face { font-family: "---Brand"; src: url(brand.woff2); }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped font family name \`---Brand\` must be lowercase, as font family names match case-insensitively, use \`---brand\`
    loc: 4:29]
  `);
});

test('should throw for a scoped variable missing its `;`', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        export const card = css\`
          ---gap: 4px
          color: red;
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... card = css\`: missing \`;\` after \`4px\`
    loc: 4:10]
  `);
});

test('should throw for quoted scoped names in `@property` initial values', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'
        createGlobalStyle\`
          @property ---anim { syntax: "*"; inherits: false; initial-value: "---spin" 1s; }
          @keyframes "---spin" { from { opacity: 0; } to { opacity: 1; } }
          body { animation: var(---anim); }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Quoted scoped names are not supported in custom properties, write \`---spin\` without quotes or the string directly in the property that uses it
    loc: 3:67]
  `);
});

test('should throw for scoped names next to null cells in grid area strings', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        export const a = css\`
          grid-template-areas: "---head...side";
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped names are not supported in grid area strings, write \`head\` as a plain name, area names are already local to their grid container
    loc: 3:23]
  `);
});

test('should throw for non-ASCII scoped font family names', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'
        createGlobalStyle\`
          @font-face { font-family: "---Ä"; src: url(a.woff2); }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped font family name \`---Ä\` must only use lowercase ASCII letters, as font family names match case-insensitively
    loc: 3:29]
  `);
});

test('should throw for scoped names with an escaped prefix', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        export const a = css\`
          ---foo: red;
          color: var(\\2d --foo);
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Scoped name \`\\2d --foo\` can't contain escapes, write it without them
    loc: 4:13]
  `);
});

test('should not treat style() values in a font property as font names', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      export const a = css\`
        ---theme: ---Dark;
        font-family: if(style(---theme: ---Dark): serif; else: sans-serif);
      \`
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-a {
      --v1560qbr-2-theme: --v1560qbr-3-Dark;
      font-family: if(
        style(--v1560qbr-2-theme: --v1560qbr-3-Dark): serif; else: sans-serif
      );
    }
    "
  `);
});
