import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

test('should warn about declared but not used scoped variables', async () => {
  const warnings: TransformWarning[] = [];

  await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Card = styled.div\`
        ---primary-color: #007bff;
        ---unused-color: #ff0000;

        background: var(---primary-color);
      \`;
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: "Scoped variable '---unused-color' is declared but never read"
        loc: '/test.tsx:3:6'
    "
  `);
});

test('should handle variables used in CSS but not declared (valid for style props)', async () => {
  const warnings: TransformWarning[] = [];

  await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Card = styled.div\`
        ---primary-color: #007bff;

        background: var(---primary-color);
        border: 1px solid var(---theme-color);
      \`;
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: "Scoped variable '---theme-color' is used but never declared"
        loc: '/test.tsx:3:6'
    "
  `);
});

test('should not warn about declarations and reads the CSS parser understands', async () => {
  const warnings: TransformWarning[] = [];

  await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Card = styled.div\`
        ---gap : 4px;
        ---theme: dark;
        padding: var( ---gap );

        @container style(---theme: dark) {
          color: white;
        }
      \`;
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});

test('should not count scoped names as declarations or reads', async () => {
  const warnings: TransformWarning[] = [];

  const result = await transformWithFormat({
    source: dedent`
      import { createGlobalStyle, styled } from 'vindur';

      createGlobalStyle\`
        @property ---angle {
          syntax: '<angle>';
          inherits: false;
          initial-value: 0deg;
        }
      \`;

      const Card = styled.div\`
        container-name: ---card;
        ---unread: 1px;
        transition-property: ---unread;

        @container ---card (min-width: 1px) {
          color: red;
        }
      \`;
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: "Scoped variable '---unread' is declared but never read"
        loc: '/test.tsx:11:6'
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    "@property --v1560qbr-2-angle {
      syntax: "<angle>";
      inherits: false;
      initial-value: 0deg;
    }

    .v1560qbr-3-Card {
      container-name: --v1560qbr-4-card;
      --v1560qbr-5-unread: 1px;
      transition-property: --v1560qbr-5-unread;

      @container --v1560qbr-4-card (min-width: 1px) {
        color: red;
      }
    }
    "
  `);
});

test('should not warn about variables declared through the style prop', async () => {
  const warnings: TransformWarning[] = [];

  await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Card = styled.div\`
        width: var(---width);
      \`;

      const App = () => <Card style={{ '---width': '1px' }} />;
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});
