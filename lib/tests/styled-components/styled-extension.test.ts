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

  test('should throw error when extending non-styled component', async () => {
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
      `[TransformError: /test.tsx: Cannot extend "notAStyledComponent": it is not a styled component. Only styled components can be extended.]`,
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
});
