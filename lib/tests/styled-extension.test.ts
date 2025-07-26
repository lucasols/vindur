import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from './testUtils';

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
      fileAbsPath: '/src/extend.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v4nysp2-1 {
        padding: 10px;
        background: blue;
      }

      .v4nysp2-2 {
        background: red;
        color: white;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div>
          <button className="v4nysp2-1">Blue</button>
          <button className="v4nysp2-1 v4nysp2-2">Red</button>
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
        fileAbsPath: '/src/invalid-extend.ts',
        fs: emptyFs,
        importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /src/invalid-extend.ts: Cannot extend "notAStyledComponent": it is not a styled component. Only styled components can be extended.]`,
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
      fileAbsPath: '/src/multiple-extend.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1496h10-1 {
        padding: 8px;
        border: none;
      }

      .v1496h10-2 {
        background: blue;
        color: white;
      }

      .v1496h10-3 {
        font-size: 18px;
        padding: 12px;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <button className="v1496h10-1 v1496h10-2 v1496h10-3">Click me</button>
      );
      "
    `);
  });
});
