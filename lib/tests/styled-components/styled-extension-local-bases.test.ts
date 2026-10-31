import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

const importAliases = { '#/': '/' };
const emptyFs = createFsMock({});

test('extend local components created by a call', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      import { memo } from 'react'

      const wrapWithTooltip = <T,>(component: T): T => component

      const Button = ({ className }: { className?: string }) => (
        <button className={className} />
      )

      const MemoButton = memo(Button)
      const ButtonWithTooltip = wrapWithTooltip(Button)

      const StyledMemo = styled(MemoButton)\`
        color: red;
      \`

      const StyledTooltip = styled(ButtonWithTooltip).attrs({ type: 'button' })\`
        color: blue;
      \`

      const App = () => (
        <>
          <StyledMemo />
          <StyledTooltip />
        </>
      )
    `,
    overrideDefaultFs: emptyFs,
    overrideDefaultImportAliases: importAliases,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vSC } from "vindur";
    import { memo } from "react";
    const wrapWithTooltip = <T,>(component: T): T => component;
    const Button = ({ className }: { className?: string }) => (
      <button className={className} />
    );
    const MemoButton = memo(Button);
    const ButtonWithTooltip = wrapWithTooltip(Button);
    const StyledTooltip = _vSC(ButtonWithTooltip, "v1560qbr-2-StyledTooltip", {
      type: "button",
    });
    const App = () => (
      <>
        <MemoButton className="v1560qbr-1-StyledMemo" />
        <StyledTooltip />
      </>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-StyledMemo {
      color: red;
    }

    .v1560qbr-2-StyledTooltip {
      color: blue;
    }
    "
  `);
});

test('should throw error when extending a call expression inline', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { Button } from './Button'

        const wrapWithTooltip = <T,>(component: T): T => component

        const StyledButton = styled(wrapWithTooltip(Button))\`
          color: red;
        \`
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: styled() cannot extend a call expression, assign it to a const first, e.g. \`const Base = wrap(Component)\` and then \`styled(Base)\`
    loc: 6:21]
  `);
});

test('should throw error when extending a call expression inline with attrs', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { memo } from 'react'
        import { Button } from './Button'

        const StyledButton = styled(memo(Button)).attrs({ type: 'button' })\`
          color: red;
        \`
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: styled() cannot extend a call expression, assign it to a const first, e.g. \`const Base = wrap(Component)\` and then \`styled(Base)\`
    loc: 5:21]
  `);
});

test('extend local components created by a call with a type cast', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      import { forwardRef } from 'react'

      const Inner = ({ className }: { className?: string }) => (
        <button className={className} />
      )

      const Button = forwardRef(Inner) as typeof Inner

      const StyledButton = styled(Button)\`
        color: red;
      \`

      export const App = () => <StyledButton />
    `,
    overrideDefaultFs: emptyFs,
    overrideDefaultImportAliases: importAliases,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { forwardRef } from "react";
    const Inner = ({ className }: { className?: string }) => (
      <button className={className} />
    );
    const Button = forwardRef(Inner) as typeof Inner;
    export const App = () => <Button className="v1560qbr-1-StyledButton" />;
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-StyledButton {
      color: red;
    }
    "
  `);
});

test('should throw error when extending a local declared with let', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { memo } from 'react'
        import { Button } from './Button'

        let MemoButton = memo(Button)

        const StyledButton = styled(MemoButton)\`
          color: red;
        \`
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Cannot extend "MemoButton": declare it with const.
    loc: 7:28]
  `);
});

test('should throw error when extending a local function declared with let', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        let Button = ({ className }: { className?: string }) => (
          <button className={className} />
        )

        const StyledButton = styled(Button)\`
          color: red;
        \`
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Cannot extend "Button": declare it with const.
    loc: 7:28]
  `);
});

test('should throw error when a binding shadows the extended component where it is rendered with dynamicColor', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { createDynamicCssColor, styled } from 'vindur'
        import { memo } from 'react'
        import { Button } from './Button'

        const color = createDynamicCssColor()
        const MemoButton = memo(Button)

        const StyledButton = styled(MemoButton)\`
          color: \${color.var};
        \`

        export const App = ({ MemoButton, c }: { MemoButton: string; c: string }) => (
          <div>
            {MemoButton}
            <StyledButton dynamicColor={color.set(c)} />
          </div>
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "MemoButton" shadows the component "MemoButton" a styled component is built from, rename this binding
    loc: 12:22]
  `);
});

test('type bindings with the extended component name do not shadow it', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      import { Item } from './Item'

      const StyledItem = styled(Item)\`
        color: red;
      \`

      export function List<Item>() {
        return <StyledItem />
      }

      export function Card() {
        type Item = { id: string }
        const item: Item = { id: '1' }
        return <StyledItem key={item.id} />
      }
    `,
    overrideDefaultFs: emptyFs,
    overrideDefaultImportAliases: importAliases,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { Item } from "./Item";
    export function List<Item>() {
      return <Item className="v1560qbr-1-StyledItem" />;
    }
    export function Card() {
      type Item = { id: string };
      const item: Item = {
        id: "1",
      };
      return <Item key={item.id} className="v1560qbr-1-StyledItem" />;
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-StyledItem {
      color: red;
    }
    "
  `);
});

test('should suggest a const for a cast call passed to styled', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { memo } from 'react'
        import { Button } from './Button'

        const StyledButton = styled(memo(Button) as typeof Button)\`
          color: red;
        \`
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: styled() cannot extend a call expression, assign it to a const first, e.g. \`const Base = wrap(Component)\` and then \`styled(Base)\`
    loc: 5:21]
  `);
});

test('should throw error when extending a local declared after the styled component', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Button = styled.button\`
          color: red;
        \`

        const StyledLink = styled(Link)\`
          color: blue;
        \`

        const Link = Button.withComponent('a')
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Cannot extend "Link": declare it before extending it.
    loc: 7:26
    ignoreInLint: true]
  `);
});

test('should throw error when a binding shadows the extended component where it is rendered', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { memo } from 'react'
        import { Button } from './Button'

        const MemoButton = memo(Button)

        const StyledButton = styled(MemoButton)\`
          color: red;
        \`

        export const App = ({ MemoButton }: { MemoButton: string }) => (
          <div>
            {MemoButton}
            <StyledButton />
          </div>
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "MemoButton" shadows the component "MemoButton" a styled component is built from, rename this binding
    loc: 11:22]
  `);
});

test('should not suggest a const for calls on the styled call', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { Button } from './Button'

        const config = () => ({})

        const StyledButton = styled(Button).withConfig(config())\`
          color: red;
        \`
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Unsupported styled component definition, use styled.tag\`...\`, styled(Component)\`...\` or add a single .attrs({...}) to them
    loc: 6:21]
  `);
});

test('should throw error when extending a destructured local', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { Popover } from './Popover'

        const { Trigger } = Popover

        const StyledTrigger = styled(Trigger)\`
          color: red;
        \`
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Cannot extend "Trigger": destructured locals can't be extended, extend the property directly, e.g. styled(object.Trigger).
    loc: 6:29]
  `);
});

test('should throw error when extending a local alias of a component', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { Popover } from './Popover'

        const Trigger = Popover.Trigger

        const StyledTrigger = styled(Trigger)\`
          color: red;
        \`
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Cannot extend "Trigger": only locals initialized with a function, a class or a call like memo(Component) can be extended, extend the original component directly instead.
    loc: 6:29]
  `);
});

test('should throw error when extending a local declared with var after the styled component', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { memo } from 'react'
        import { Button } from './Button'

        const StyledButton = styled(MemoButton)\`
          color: red;
        \`

        var MemoButton = memo(Button)
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Cannot extend "MemoButton": declare it with const.
    loc: 5:28]
  `);
});

test('should throw error when withComponent uses a local declared after it', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { memo } from 'react'
        import { Button } from './Button'

        const Box = styled.div\`
          color: red;
        \`

        export const MemoBox = Box.withComponent(MemoButton)

        const MemoButton = memo(Button)
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Cannot extend "MemoButton": declare it before extending it.
    loc: 9:41
    ignoreInLint: true]
  `);
});
