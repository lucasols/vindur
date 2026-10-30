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
      [TransformError: /test.tsx: Cannot extend "NotAComponent": it is not a component or styled component.
      loc: 4:31
      ignoreInLint: true]
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
