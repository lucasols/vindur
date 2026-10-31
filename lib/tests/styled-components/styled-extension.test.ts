import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

const importAliases = { '#/': '/' };
const emptyFs = createFsMock({});

describe('styled component extension', () => {
  test('should extend styled components with styled(Component)', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Button = styled.button\`
        padding: 10px;
        background: blue;
      \`

      const RedButton = styled(Button)\`
        background: red;
        color: white;
      \`

      const App = () => (
        <div>
          <Button>Blue</Button>
          <RedButton>Red</RedButton>
        </div>
      )
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 10px;
        background: blue;
      }

      .v1560qbr-2-RedButton {
        background: red;
        color: white;
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div>
          <button className="v1560qbr-1-Button">Blue</button>
          <button className="v1560qbr-1-Button v1560qbr-2-RedButton">Red</button>
        </div>
      );
      "
    `);
  });

  test('should throw error when extending non-CamelCase identifier', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const notAStyledComponent = 'regular-variable'
      const FailedExtension = styled(notAStyledComponent)\`
        color: red;
      \`
    `;

    await expect(async () => {
      await transformWithFormat({
        source,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: Cannot extend "notAStyledComponent": component names must start with an uppercase letter (CamelCase).
      loc: 4:31]
    `,
    );
  });

  test('should throw error when extending non-component variable with CamelCase', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const NotAComponent = 'regular-variable'
      const FailedExtension = styled(NotAComponent)\`
        color: red;
      \`
    `;

    await expect(async () => {
      await transformWithFormat({
        source,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: Cannot extend "NotAComponent": only locals initialized with a function, a class or a call like memo(Component) can be extended, extend the original component directly instead.
      loc: 4:31]
    `,
    );
  });

  test('extending multiple times', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const BaseButton = styled.button\`
        padding: 8px;
        border: none;
      \`

      const BlueButton = styled(BaseButton)\`
        background: blue;
        color: white;
      \`

      const LargeBlueButton = styled(BlueButton)\`
        font-size: 18px;
        padding: 12px;
      \`

      const App = () => <LargeBlueButton>Click me</LargeBlueButton>
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-BaseButton {
        padding: 8px;
        border: none;
      }

      .v1560qbr-2-BlueButton {
        background: blue;
        color: white;
      }

      .v1560qbr-3-LargeBlueButton {
        font-size: 18px;
        padding: 12px;
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <button className="v1560qbr-1-BaseButton v1560qbr-2-BlueButton v1560qbr-3-LargeBlueButton">
          Click me
        </button>
      );
      "
    `);
  });

  test('extend from custom components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Component = ({ className }: { className?: string }) => (
          <div className={className} />
        )

        const Styled = styled(Component)\`
          color: red;
        \`

        const App = () => (
          <Styled />
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Styled {
        color: red;
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = ({ className }: { className?: string }) => (
        <div className={className} />
      );
      const App = () => <Component className="v1560qbr-1-Styled" />;
      "
    `);
  });

  test('extend from imported custom components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { Component } from './Component'


        const Styled = styled(Component)\`
          color: red;
        \`

        const App = () => (
          <Styled />
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Styled {
        color: red;
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { Component } from "./Component";
      const App = () => <Component className="v1560qbr-1-Styled" />;
      "
    `);
  });

  test('extend from imported custom components from library', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { Component } from 'react-dom'


        const Styled = styled(Component)\`
          color: red;
        \`

        const App = () => (
          <Styled />
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Styled {
        color: red;
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { Component } from "react-dom";
      const App = () => <Component className="v1560qbr-1-Styled" />;
      "
    `);
  });

  test('extend motion lib elements', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { motion } from 'framer-motion'

        const StyledMotionDiv = styled(motion.div)\`
          color: red;
        \`

        const App = () => (
          <StyledMotionDiv />
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-StyledMotionDiv {
        color: red;
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { motion } from "framer-motion";
      const App = () => <motion.div className="v1560qbr-1-StyledMotionDiv" />;
      "
    `);
  });
});

const itemWithFlagFs = createFsMock({
  'item.tsx': dedent`
    import { styled } from 'vindur';

    export const Item = styled.div<{ active: boolean }>\`
      &.active {
        color: red;
      }
    \`;
  `,
});

test('extending an imported styled component keeps the flags it applies', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      import { Item } from './item'

      const BigItem = styled(Item)<{ big: boolean }>\`
        &.big {
          padding: 8px;
        }
        &.active {
          color: blue;
        }
      \`

      export const App = () => <BigItem active big />
    `,
    overrideDefaultFs: itemWithFlagFs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { Item } from "./item";
    export const App = () => (
      <Item active className={"v1560qbr-1-BigItem v1560qbr-1-BigItem-big"} />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-BigItem {
      &.v1560qbr-1-BigItem-big {
        padding: 8px;
      }
      &.v1llrsih-1-Item-active {
        color: blue;
      }
    }
    "
  `);
});

test('should throw for a flag with the prop of a flag of an imported base', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { Item } from './item'

        const OtherItem = styled(Item)<{ active: boolean }>\`
          &.active {
            color: blue;
          }
        \`

        export const App = () => <OtherItem active />
      `,
      overrideDefaultFs: itemWithFlagFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag \`active\` is also a style flag of \`Item\`, which would no longer get the prop, use another name
    loc: 4:30]
  `);
});

test('should throw for bindings shadowing the base of a styled component', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Card = (props: { className?: string }) => <div {...props} />
        const StyledCard = styled(Card)\`color: red;\`

        export function App({ Card }) {
          return <StyledCard />
        }
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "Card" shadows the component "Card" a styled component is built from, rename this binding
    loc: 6:22]
  `);
});

test('should throw for a caught error shadowing the base of a styled component', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Card = (props: { className?: string }) => <div {...props} />
        const StyledCard = styled(Card)\`color: red;\`

        export function App() {
          try {
            return null
          } catch (Card) {
            return <StyledCard />
          }
        }
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "Card" shadows the component "Card" a styled component is built from, rename this binding
    loc: 9:11]
  `);
});

test('should allow shadowing the base of a styled component kept as a runtime component', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      const Card = (props: { className?: string }) => <div {...props} />
      export const StyledCard = styled(Card)\`color: red;\`

      export function App({ Card }) {
        return <StyledCard />
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vSC } from "vindur";
    const Card = (props: { className?: string }) => <div {...props} />;
    export const StyledCard = _vSC(Card, "v1560qbr-1-StyledCard");
    export function App({ Card }) {
      return <StyledCard />;
    }
    "
  `);
});

test('should allow shadowing a base rendered through a runtime withComponent element', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      const Card = (props: { className?: string }) => <div {...props} />
      const Box = styled.div\`padding: 1px;\`
      const Target = styled(Card)\`color: red;\`
      const B = Box.withComponent(Target)

      export const App = ({ Card }: { Card: string }) => <B title={Card} />
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vSC } from "vindur";
    const Card = (props: { className?: string }) => <div {...props} />;
    const Target = _vSC(Card, "v1560qbr-2-Target");
    export const App = ({ Card }: { Card: string }) => (
      <Target title={Card} className="v1560qbr-1-Box" />
    );
    "
  `);
});

test('should allow type parameters with the name of a base of a styled component', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      const Card = (props: { className?: string }) => <div {...props} />
      const StyledCard = styled(Card)\`color: red;\`

      export function List<Card>(items: Card[]) {
        return <StyledCard />
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const Card = (props: { className?: string }) => <div {...props} />;
    export function List<Card>(items: Card[]) {
      return <Card className="v1560qbr-1-StyledCard" />;
    }
    "
  `);
});

test('should allow bindings with the name of a base where the styled component is not used', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      const Card = (props: { className?: string }) => <div {...props} />
      const StyledCard = styled(Card)\`color: red;\`

      export function format(Card: string): string;
      export function format(value: string) {
        return value
      }

      export const App = () => <StyledCard />
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const Card = (props: { className?: string }) => <div {...props} />;
    export function format(Card: string): string;
    export function format(value: string) {
      return value;
    }
    export const App = () => <Card className="v1560qbr-1-StyledCard" />;
    "
  `);
});
