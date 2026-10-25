import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/transform';
import { transformWithFormat } from '../testUtils';

test('should rename style prop variables read by css props', async () => {
  const warnings: TransformWarning[] = [];

  const result = await transformWithFormat({
    source: dedent`
      const App = ({ width }: { width: string }) => (
        <div style={{ '---width': width }} css={\`width: var(---width);\`}>
          <span css={\`height: var(---width);\`} />
        </div>
      )
    `,
    onWarning: (warning) => warnings.push(warning),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const App = ({ width }: { width: string }) => (
      <div
        style={{
          "--v1560qbr-2-width": width,
        }}
        className="v1560qbr-1-css-prop-1"
      >
        <span className="v1560qbr-2-css-prop-2" />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-css-prop-1 {
      width: var(--v1560qbr-2-width);
    }

    .v1560qbr-2-css-prop-2 {
      height: var(--v1560qbr-2-width);
    }
    "
  `);

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});
