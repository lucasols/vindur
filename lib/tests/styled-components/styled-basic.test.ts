import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

const importAliases = { '#/': '/' };
const emptyFs = createFsMock({});

describe('styled components - basic functionality', () => {
  test('should transform styled.div components', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Container = styled.div\`
        background-color: red;
        padding: 10px;
      \`

      const Component = () => {
        return <Container />;
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Container {
        background-color: red;
        padding: 10px;
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return <div className="v1560qbr-1-Container" />;
      };
      "
    `);
  });

  test('should transform styled components in dev mode with variable names', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Button = styled.button\`
        padding: 8px 16px;
        background: blue;
        color: white;
      \`

      const Header = styled.h1\`
        font-size: 24px;
        font-weight: bold;
      \`

      const Component = () => {
        return (
          <div>
            <Button>Click me</Button>
            <Header>Title</Header>
          </div>
        );
      }
    `;

    const result = await transformWithFormat({
      source,

      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 8px 16px;
        background: blue;
        color: white;
      }

      .v1560qbr-2-Header {
        font-size: 24px;
        font-weight: bold;
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return (
          <div>
            <button className="v1560qbr-1-Button">Click me</button>
            <h1 className="v1560qbr-2-Header">Title</h1>
          </div>
        );
      };
      "
    `);
  });

  test('should handle variable interpolation in styled components', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const primaryColor = 'blue'
      const padding = 12

      const StyledButton = styled.button\`
        background-color: \${primaryColor};
        padding: \${padding}px;
        border: 1px solid \${'gray'};
      \`

      const App = () => <StyledButton>Click</StyledButton>
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-StyledButton {
        background-color: blue;
        padding: 12px;
        border: 1px solid gray;
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const primaryColor = "blue";
      const padding = 12;
      const App = () => <button className="v1560qbr-1-StyledButton">Click</button>;
      "
    `);
  });

  test('should support different HTML elements', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const StyledDiv = styled.div\`color: red;\`
      const StyledSpan = styled.span\`color: blue;\`
      const StyledP = styled.p\`color: green;\`
      const StyledButton = styled.button\`color: purple;\`
      const StyledInput = styled.input\`color: orange;\`

      const Component = () => (
        <div>
          <StyledDiv>div</StyledDiv>
          <StyledSpan>span</StyledSpan>
          <StyledP>p</StyledP>
          <StyledButton>button</StyledButton>
          <StyledInput />
        </div>
      )
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-StyledDiv {
        color: red;
      }

      .v1560qbr-2-StyledSpan {
        color: blue;
      }

      .v1560qbr-3-StyledP {
        color: green;
      }

      .v1560qbr-4-StyledButton {
        color: purple;
      }

      .v1560qbr-5-StyledInput {
        color: orange;
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => (
        <div>
          <div className="v1560qbr-1-StyledDiv">div</div>
          <span className="v1560qbr-2-StyledSpan">span</span>
          <p className="v1560qbr-3-StyledP">p</p>
          <button className="v1560qbr-4-StyledButton">button</button>
          <input className="v1560qbr-5-StyledInput" />
        </div>
      );
      "
    `);
  });

  test('should throw error for direct styled component usage', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Component = () => {
        return styled.div\`
          background: red;
        \`
      }
    `;

    await expect(async () => {
      await transformWithFormat({
        source,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[TransformError: /test.tsx: Inline styled component usage is not supported. Please assign styled components to a variable first.]`,
    );
  });
});
