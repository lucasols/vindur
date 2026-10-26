import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
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
      &[data-name="--v1560qbr-2-card"],
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
