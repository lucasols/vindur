import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

test('should throw error for non-boolean and non-string-union types in style flags', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const StyledWithModifier = styled.div<{
          count: number; // Not boolean or string union
        }>\`
          &.active { ... }
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
    [TransformError: /test.tsx: Style flags only support boolean properties and string literal unions. Property "count" has type "number".
    loc: 4:2]
  `,
  );
});

test('should warn about missing modifier styles', async () => {
  const warnings: TransformWarning[] = [];

  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const StyledWithModifier = styled.div<{
        active: boolean;
      }>\`
        padding: 16px;
      \`;

      function Component() {
        return (
          <StyledWithModifier active={true}>
            Content
          </StyledWithModifier>
        );
      }
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: 'Warning: Missing modifier styles for "&.active" in StyledWithModifier'
        loc: 'current_file:3:6'
    "
  `);

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component() {
      return (
        <div className={cx("v1560qbr-1-StyledWithModifier", "voctcyj-active")}>
          Content
        </div>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-StyledWithModifier {
      padding: 16px;
    }
    "
  `);
});
