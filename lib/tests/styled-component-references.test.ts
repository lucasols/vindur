import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from './testUtils';

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
      ".v1560qbr-1 {
        background-color: red;
      }

      .v1560qbr-2 {
        .v1560qbr-1:hover & {
          background-color: blue;
        }
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div>
          <div className="v1560qbr-1" />
          <div className="v1560qbr-2" />
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
      ".v1560qbr-1 {
        padding: 16px;
        border: 1px solid gray;
      }

      .v1560qbr-2 {
        background: blue;
        color: white;
      }

      .v1560qbr-3 {
        .v1560qbr-1 & {
          transform: scale(1.02);
        }

        .v1560qbr-1:hover & {
          background: lightgray;
        }

        & .v1560qbr-2:active {
          transform: scale(0.98);
        }
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div className="v1560qbr-1">
          <div className="v1560qbr-3">
            <button className="v1560qbr-2">Click me</button>
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
      `[Error: /test.tsx: Invalid interpolation used at \`... Button = styled\` ... \${UndefinedComponent}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported]`,
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
      `[Error: /test.tsx: Invalid interpolation used at \`... Button = styled\` ... \${Container}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported]`,
    );
  });
});
