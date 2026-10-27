import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should replace `$` of variable names in dev class and variable names', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const $bg = createDynamicCssColor()

      const $Box = styled.div\`
        background: \${$bg.value};

        \${$bg.self.isDark} {
          color: white;
        }
      \`

      const Component = ({ c }) => <$Box dynamicColor={$bg.set(c)} />;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const $bg = createDynamicCssColor("v1560qbr-1-_bg", true);
    const Component = ({ c }) => (
      <div
        {...$bg._sp(c, {
          className: "v1560qbr-2-_Box",
        })}
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-2-_Box {
      background: var(--v1560qbr-1-_bg);

      &.v1560qbr-1-_bg-self-isDark {
        color: white;
      }
    }
    "
  `);
});
