import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should handle exported styled components with style flags', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      export const Button = styled.button<{
        primary: boolean;
      }>\`
        padding: 8px 16px;

        &.primary {
          background: blue;
        }
      \`;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vCWM } from "vindur";
    export const Button = _vCWM(
      [["primary", "v1puiack-primary"]],
      "v1560qbr-1-Button",
      "button",
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      padding: 8px 16px;

      &.v1puiack-primary {
        background: blue;
      }
    }
    "
  `);
});
