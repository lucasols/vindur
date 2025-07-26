import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from './testUtils';

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
      fileAbsPath: '/src/test.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vmcre00-1 {
        background-color: red;
        padding: 10px;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return <div className="vmcre00-1" />;
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
      fileAbsPath: '/src/components.ts',
      dev: true,
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vcixwtu-1-Button {
        padding: 8px 16px;
        background: blue;
        color: white;
      }

      .vcixwtu-2-Header {
        font-size: 24px;
        font-weight: bold;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return (
          <div>
            <button className="vcixwtu-1-Button">Click me</button>
            <h1 className="vcixwtu-2-Header">Title</h1>
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
      fileAbsPath: '/src/styled-button.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vi3fon9-1 {
        background-color: blue;
        padding: 12px;
        border: 1px solid gray;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const primaryColor = "blue";
      const padding = 12;
      const App = () => <button className="vi3fon9-1">Click</button>;
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
      fileAbsPath: '/src/elements.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1012akl-1 {
        color: red;
      }

      .v1012akl-2 {
        color: blue;
      }

      .v1012akl-3 {
        color: green;
      }

      .v1012akl-4 {
        color: purple;
      }

      .v1012akl-5 {
        color: orange;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => (
        <div>
          <div className="v1012akl-1">div</div>
          <span className="v1012akl-2">span</span>
          <p className="v1012akl-3">p</p>
          <button className="v1012akl-4">button</button>
          <input className="v1012akl-5" />
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
        fileAbsPath: '/src/direct.ts',
        fs: emptyFs,
        importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /src/direct.ts: Inline styled component usage is not supported. Please assign styled components to a variable first.]`,
    );
  });
});
