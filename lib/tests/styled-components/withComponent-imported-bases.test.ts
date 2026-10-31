import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

test('should throw for withComponent of a component that inherits a style flag of the base', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { Item } from '#/item'

        const Base = styled.div<{ active: boolean }>\`&.active { color: blue; }\`
        const LocalItem = styled(Item)\`padding: 4px;\`
        const LinkedItem = Base.withComponent(LocalItem)

        export const App = () => <LinkedItem active />
      `,
      overrideDefaultFs: createFsMock({
        'item.tsx': dedent`
          import { styled } from 'vindur'

          export const Item = styled.div<{ active: boolean }>\`&.active { color: red; }\`
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag \`active\` of \`Base\` is also a style flag of \`LocalItem\`, which would no longer get the prop, rename one of them
    loc: 6:38]
  `);
});

test('should throw for withComponent of a component extending an imported styled component', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { Item } from '#/item'

        const LocalItem = styled(Item)\`padding: 4px;\`
        const LinkedItem = LocalItem.withComponent('a')

        export const App = () => <LinkedItem />
      `,
      overrideDefaultFs: createFsMock({
        'item.tsx': dedent`
          import { styled } from 'vindur'

          export const Item = styled.div\`color: red;\`
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Cannot call withComponent on "LocalItem": it extends the imported styled component "Item", whose styles would be lost on the new element. Call withComponent on "Item" in its own file and extend that instead.
    loc: 5:19]
  `);
});
