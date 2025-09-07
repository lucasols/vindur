import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('styled component references', () => {
  test('should handle styled component reference with & selector', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Container = styled.div\`
          background-color: red;
        \`

        const Button = styled.div\`
          \${Container}:hover & {
            background-color: blue;
          }
        \`

        const App = () => (
          <div>
            <Container />
            <Button />
          </div>
        )
      `,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Container {
        background-color: red;
      }

      .v1560qbr-2-Button {
        .v1560qbr-1-Container:hover & {
          background-color: blue;
        }
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div>
          <div className="v1560qbr-1-Container" />
          <div className="v1560qbr-2-Button" />
        </div>
      );
      "
    `);
  });

  test('should handle mixed styled component references with & patterns', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Card = styled.div\`
          padding: 16px;
          border: 1px solid gray;
        \`

        const Button = styled.button\`
          background: blue;
          color: white;
        \`

        const Interactive = styled.div\`
          \${Card} & {
            transform: scale(1.02);
          }
  
          \${Card}:hover & {
            background: lightgray;
          }
  
          & \${Button}:active {
            transform: scale(0.98);
          }
        \`

        const App = () => (
          <Card>
            <Interactive>
              <Button>Click me</Button>
            </Interactive>
          </Card>
        )
      `,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        padding: 16px;
        border: 1px solid gray;
      }

      .v1560qbr-2-Button {
        background: blue;
        color: white;
      }

      .v1560qbr-3-Interactive {
        .v1560qbr-1-Card & {
          transform: scale(1.02);
        }

        .v1560qbr-1-Card:hover & {
          background: lightgray;
        }

        & .v1560qbr-2-Button:active {
          transform: scale(0.98);
        }
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div className="v1560qbr-1-Card">
          <div className="v1560qbr-3-Interactive">
            <button className="v1560qbr-2-Button">Click me</button>
          </div>
        </div>
      );
      "
    `);
  });

  test('should throw error when referencing undefined styled component', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Button = styled.div\`
            \${UndefinedComponent}:hover & {
              background-color: blue;
            }
          \`
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: Invalid interpolation used at \`... Button = styled\` ... \${UndefinedComponent}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
      loc: {
        "column": 4,
        "filename": undefined,
        "line": 4,
      }
      ignoreInLint: true]
    `,
    );
  });

  test('should throw error when using styled component reference without &', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Button = styled.div\`
            \${Container} {
              color: blue;
            }
          \`
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: Invalid interpolation used at \`... Button = styled\` ... \${Container}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
      loc: {
        "column": 4,
        "filename": undefined,
        "line": 4,
      }
      ignoreInLint: true]
    `,
    );
  });

  test('should handle styled component references in css functions', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const Button = styled.button\`
          background: blue;
          color: white;
          padding: 8px 16px;
        \`

        const hoverStyles = css\`
          \${Button}:hover & {
            transform: scale(1.05);
          }

          & \${Button}:focus {
            outline: 2px solid blue;
          }
        \`

        const App = () => (
          <div className={hoverStyles}>
            <Button>Click me</Button>
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const hoverStyles = "v1560qbr-2-hoverStyles";
      const App = () => (
        <div className={hoverStyles}>
          <button className="v1560qbr-1-Button">Click me</button>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: blue;
        color: white;
        padding: 8px 16px;
      }

      .v1560qbr-2-hoverStyles {
        .v1560qbr-1-Button:hover & {
          transform: scale(1.05);
        }

        & .v1560qbr-1-Button:focus {
          outline: 2px solid blue;
        }
      }
      "
    `);
  });

  test('should handle multiple styled component references in css functions', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const Card = styled.div\`
          background: white;
          padding: 16px;
          border-radius: 8px;
        \`

        const Title = styled.h2\`
          font-size: 18px;
          color: #333;
          margin: 0;
        \`

        const layoutStyles = css\`
          display: grid;
          gap: 16px;

          \${Card} \${Title} {
            font-size: 20px;
          }

          \${Card}:hover \${Title} {
            color: #007bff;
          }

          & \${Card}:last-child {
            margin-bottom: 0;
          }
        \`

        const App = () => (
          <div className={layoutStyles}>
            <Card>
              <Title>Card Title</Title>
            </Card>
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const layoutStyles = "v1560qbr-3-layoutStyles";
      const App = () => (
        <div className={layoutStyles}>
          <div className="v1560qbr-1-Card">
            <h2 className="v1560qbr-2-Title">Card Title</h2>
          </div>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        background: white;
        padding: 16px;
        border-radius: 8px;
      }

      .v1560qbr-2-Title {
        font-size: 18px;
        color: #333;
        margin: 0;
      }

      .v1560qbr-3-layoutStyles {
        display: grid;
        gap: 16px;

        .v1560qbr-1-Card .v1560qbr-2-Title {
          font-size: 20px;
        }

        .v1560qbr-1-Card:hover .v1560qbr-2-Title {
          color: #007bff;
        }

        & .v1560qbr-1-Card:last-child {
          margin-bottom: 0;
        }
      }
      "
    `);
  });

  test('should handle styled component references with css extensions', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const Button = styled.button\`
          background: blue;
          color: white;
          padding: 8px 16px;
        \`

        const baseLayout = css\`
          display: flex;
          gap: 16px;
        \`

        const interactiveLayout = css\`
          \${baseLayout};

          \${Button}:hover {
            background: darkblue;
          }

          & \${Button}:active {
            transform: scale(0.95);
          }
        \`

        const App = () => (
          <div className={interactiveLayout}>
            <Button>Click me</Button>
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const baseLayout = "v1560qbr-2-baseLayout";
      const interactiveLayout = "v1560qbr-3-interactiveLayout";
      const App = () => (
        <div className={interactiveLayout}>
          <button className="v1560qbr-1-Button">Click me</button>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: blue;
        color: white;
        padding: 8px 16px;
      }

      .v1560qbr-2-baseLayout {
        display: flex;
        gap: 16px;
      }

      .v1560qbr-3-interactiveLayout {
        display: flex;
        gap: 16px;

        .v1560qbr-1-Button:hover {
          background: darkblue;
        }

        & .v1560qbr-1-Button:active {
          transform: scale(0.95);
        }
      }
      "
    `);
  });
});
