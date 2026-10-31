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

const defaultCardFs = createFsMock({
  'card.tsx': dedent`
    import { styled } from 'vindur'

    const Card = styled.div<{ on: boolean }>\`
      color: blue;
      &.on { color: yellow; }
    \`

    export default Card
  `,
});

test('extending a default imported styled component keeps its flags', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      import Card from '#/card'

      const Ext = styled(Card)\`
        &.on { color: green; }
      \`

      export const App = ({ on }) => <Ext on={on} />
    `,
    overrideDefaultFs: defaultCardFs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import Card from "#/card";
    export const App = ({ on }) => <Card on={on} className="v1560qbr-1-Ext" />;
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Ext {
      &.v1318azr-on {
        color: green;
      }
    }
    "
  `);
});

test('should throw for a flag of a default imported styled base', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import Card from '#/card'

        const Ext = styled(Card)<{ on: boolean }>\`&.on { color: green; }\`

        export const App = ({ on }) => <Ext on={on} />
      `,
      overrideDefaultFs: defaultCardFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag \`on\` is also a style flag of \`Card\`, which would no longer get the prop, use another name
    loc: 4:24]
  `);
});

test('should throw for withComponent of a component extending a default imported styled component', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import Card from '#/card'

        const Ext = styled(Card)\`padding: 4px;\`
        const Link = Ext.withComponent('a')

        export const App = () => <Link />
      `,
      overrideDefaultFs: defaultCardFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Cannot call withComponent on "Ext": it extends the imported styled component "Card", whose styles would be lost on the new element. Call withComponent on "Card" in its own file and extend that instead.
    loc: 5:13]
  `);
});

test('should allow withComponent of a component rendering an imported styled component', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      import Card from '#/card'

      const Box = styled.div\`padding: 4px;\`
      const AsCard = Box.withComponent(Card)
      const Link = AsCard.withComponent('a')

      export const App = () => <Link href="/" />
    `,
    overrideDefaultFs: defaultCardFs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import Card from "#/card";
    export const App = () => <a href="/" className="v1560qbr-1-Box" />;
    "
  `);
});

test('withComponent keeps the flags of its styled component element for references', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      const Item = styled.div<{ active: boolean }>\`&.active { color: red; }\`
      const Base = styled.div\`padding: 4px;\`
      const LinkedItem = Base.withComponent(Item)

      const List = styled.div\`
        \${LinkedItem}.active & { color: blue; }
      \`

      export const App = ({ active }) => (
        <LinkedItem active={active}>
          <List />
        </LinkedItem>
      )
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Item {
      &.voctcyj-active {
        color: red;
      }
    }

    .v1560qbr-2-Base {
      padding: 4px;
    }

    .v1560qbr-3-List {
      .v1560qbr-2-Base.voctcyj-active & {
        color: blue;
      }
    }
    "
  `);
});

const reExportedCardFs = createFsMock({
  'components.ts': `export { Card } from './card';`,
  'card.tsx': dedent`
    import { styled } from 'vindur';

    export const Card = styled.div\`
      color: red;
    \`;
  `,
});

test('should throw for style flags and withComponent on a re-exported styled base', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { Card } from '#/components';

        const Ext = styled(Card)<{ big: boolean }>\`
          &.big { color: blue; }
        \`;

        export const App = () => <Ext big />;
      `,
      overrideDefaultFs: reExportedCardFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "Card" is re-exported by /components.ts from "./card", re-exports via \`export ... from\` are not supported, import it from "./card" directly
    loc: 4:19]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { Card } from '#/components';

        const Ext = styled(Card)\`
          color: blue;
        \`;

        const Link = Ext.withComponent('a');

        export const App = () => <Link />;
      `,
      overrideDefaultFs: reExportedCardFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "Card" is re-exported by /components.ts from "./card", re-exports via \`export ... from\` are not supported, import it from "./card" directly
    loc: 8:13]
  `);
});

test('should extend a re-exported component without style flags', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { Card } from '#/components';

      const Ext = styled(Card)\`
        color: blue;
      \`;

      export const App = () => <Ext />;
    `,
    overrideDefaultFs: createFsMock({
      'components.ts': `export { Card } from './card';`,
      'card.tsx': dedent`
        export const Card = (props: { className?: string }) => <div {...props} />;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { Card } from "#/components";
    export const App = () => <Card className="v1560qbr-1-Ext" />;
    "
  `);
});

test('should throw for selecting a style flag through withComponent elements with different flags', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { Item } from '#/item';
        import { Other } from '#/other';

        const Base = styled.div\`
          padding: 1px;
        \`;

        const A = Base.withComponent(Item);
        const B = Base.withComponent(Other);

        const Child = styled.span\`
          \${A}.active & { color: green; }
        \`;

        export const App = ({ on }: { on: boolean }) => (
          <>
            <A active={on}>
              <Child />
            </A>
            <B active={on} />
          </>
        );
      `,
      overrideDefaultFs: createFsMock({
        'item.tsx': dedent`
          import { styled } from 'vindur';

          export const Item = styled.div<{ active: boolean }>\`
            &.active { color: red; }
          \`;
        `,
        'other.tsx': dedent`
          import { styled } from 'vindur';

          export const Other = styled.div<{ active: boolean }>\`
            &.active { color: blue; }
          \`;
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "active" can't be selected through a reference to "A" or "B", they share the class of the styled component they were made from with withComponent, but their elements have different flags. Select it through a reference to the element's styled component instead.
    loc: 12:6]
  `);
});
