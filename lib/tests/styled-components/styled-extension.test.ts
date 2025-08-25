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
      loc: {
        "column": 31,
        "filename": undefined,
        "line": 4,
      }]
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
      loc: {
        "column": 31,
        "filename": undefined,
        "line": 4,
      }]
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
});
