import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('JSX css prop', () => {
  test('should handle css prop with template literal', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const App = () => (
          <div css={\`
            background: blue;
            padding: 20px;
            color: white;
          \`}>
            Hello World
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <div className="v1560qbr-1-css-prop-1">Hello World</div>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-css-prop-1 {
        background: blue;
        padding: 20px;
        color: white;
      }
      "
    `);
  });

  test('should handle css prop with css function call', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const styles = css\`
          background: red;
          margin: 10px;
          border-radius: 4px;
        \`

        const App = () => (
          <div css={styles}>
            Hello World
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-1-styles";
      const App = () => <div className={styles}>Hello World</div>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        background: red;
        margin: 10px;
        border-radius: 4px;
      }
      "
    `);
  });

  test('should merge css prop with existing className', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const App = () => (
          <div 
            className="existing-class"
            css={\`
              color: green;
              font-weight: bold;
            \`}
          >
            Hello World
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div className="existing-class v1560qbr-1-css-prop-1">Hello World</div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-css-prop-1 {
        color: green;
        font-weight: bold;
      }
      "
    `);
  });

  test('should handle css prop with variable interpolation', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const primaryColor = '#007bff'
        const spacing = 16

        const App = () => (
          <div css={\`
            background: \${primaryColor};
            padding: \${spacing}px;
            margin: \${spacing / 2}px;
          \`}>
            Hello World
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const primaryColor = "#007bff";
      const spacing = 16;
      const App = () => <div className="v1560qbr-1-css-prop-1">Hello World</div>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-css-prop-1 {
        background: #007bff;
        padding: 16px;
        margin: 8px;
      }
      "
    `);
  });

  test('should handle multiple elements with css prop', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const App = () => (
          <div>
            <h1 css={\`color: blue; font-size: 24px;\`}>
              Title
            </h1>
            <p css={\`color: red; margin: 10px;\`}>
              Paragraph
            </p>
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div>
          <h1 className="v1560qbr-1-css-prop-1">Title</h1>
          <p className="v1560qbr-2-css-prop-2">Paragraph</p>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-css-prop-1 {
        color: blue;
        font-size: 24px;
      }

      .v1560qbr-2-css-prop-2 {
        color: red;
        margin: 10px;
      }
      "
    `);
  });

  test('should handle css prop with CSS nesting', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const App = () => (
          <div css={\`
            background: white;
            padding: 20px;
    
            h2 {
              color: #333;
              margin-bottom: 16px;
            }
    
            &:hover {
              transform: translateY(-2px);
            }
          \`}>
            <h2>Card Title</h2>
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div className="v1560qbr-1-css-prop-1">
          <h2>Card Title</h2>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-css-prop-1 {
        background: white;
        padding: 20px;

        h2 {
          color: #333;
          margin-bottom: 16px;
        }

        &:hover {
          transform: translateY(-2px);
        }
      }
      "
    `);
  });

  test('should handle css prop with css style extension', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const baseStyles = css\`
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #ddd;
        \`

        const App = () => (
          <div css={\`
            \${baseStyles};
            background: white;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          \`}>
            Card Content
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const baseStyles = "v1560qbr-1-baseStyles";
      const App = () => <div className="v1560qbr-2-css-prop-2">Card Content</div>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-baseStyles {
        padding: 16px;
        border-radius: 8px;
        border: 1px solid #ddd;
      }

      .v1560qbr-2-css-prop-2 {
        padding: 16px;
        border-radius: 8px;
        border: 1px solid #ddd;
        background: white;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      "
    `);
  });

  test('should handle css prop with styled component references', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const Button = styled.button\`
          background: #007bff;
          color: white;
          padding: 8px 16px;
          border: none;
        \`

        const App = () => (
          <div css={\`
            padding: 20px;
    
            & \${Button}:hover {
              background: #0056b3;
            }
          \`}>
            <Button>Click me</Button>
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div className="v1560qbr-2-css-prop-2">
          <button className="v1560qbr-1-Button">Click me</button>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: #007bff;
        color: white;
        padding: 8px 16px;
        border: none;
      }

      .v1560qbr-2-css-prop-2 {
        padding: 20px;

        & .v1560qbr-1-Button:hover {
          background: #0056b3;
        }
      }
      "
    `);
  });

  test('should handle css prop with multiple className attributes', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const App = () => (
          <div 
            className="first"
            className="second"
            css={\`background: yellow;\`}
          >
            Content
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div className="first" className="second v1560qbr-1-css-prop-1">
          Content
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-css-prop-1 {
        background: yellow;
      }
      "
    `);
  });

  test('should process css prop on styled components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const Card = styled.div\`
          background: white;
          padding: 20px;
        \`

        const App = () => (
          <Card css={\`border: 1px solid red;\`}>
            Card with additional styling
          </Card>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div className="v1560qbr-1-Card v1560qbr-2-css-prop-2">
          Card with additional styling
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        background: white;
        padding: 20px;
      }

      .v1560qbr-2-css-prop-2 {
        border: 1px solid red;
      }
      "
    `);
  });

  test('should handle css prop on custom components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const CustomComponent = ({ children }) => <div>{children}</div>

        const App = () => (
          <CustomComponent css={\`color: red;\`}>
            This should keep the css prop
          </CustomComponent>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const CustomComponent = ({ children }) => <div>{children}</div>;
      const App = () => (
        <CustomComponent css="v1560qbr-1-css-prop-1">
          This should keep the css prop
        </CustomComponent>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-css-prop-1 {
        color: red;
      }
      "
    `);
  });

  test('css props on custom components that are just references to unknown values should be allowed', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { CustomComponent } from 'custom';

        const App: FC<{ css?: string }> = ({ css }) => (
          // css is just being forwarded, so this should not be an error
          <CustomComponent css={css}>
            This should keep the css prop
          </CustomComponent>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { CustomComponent } from "custom";
      const App: FC<{
        css?: string;
      }> = ({ css }) => (
        // css is just being forwarded, so this should not be an error
        <CustomComponent css={css}>This should keep the css prop</CustomComponent>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('css props on style extensions that are just references to unknown values should be allowed', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { CustomComponent } from '@/custom';

        const Component = styled(CustomComponent)\`
          color: red;
        \`

        const App: FC<{ css?: string }> = ({ css }) => (
          // css is just being forwarded, so this should not be an error
          <Component css={css}>
            This should keep the css prop
          </Component>
        )
      `,
      overrideDefaultFs: createFsMock({
        'custom.ts': dedent`
          export const CustomComponent = () => <div>Custom Component</div>
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { CustomComponent } from "@/custom";
      const App: FC<{
        css?: string;
      }> = ({ css }) => (
        // css is just being forwarded, so this should not be an error
        <CustomComponent css={css} className={"v1560qbr-1-Component"}>
          This should keep the css prop
        </CustomComponent>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Component {
        color: red;
      }
      "
    `);
  });

  test('should handle css prop with css function reference on custom components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const styles = css\`
          background: blue;
          padding: 10px;
        \`

        const CustomComponent = ({ children }) => <div>{children}</div>

        const App = () => (
          <CustomComponent css={styles}>
            With css reference
          </CustomComponent>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-1-styles";
      const CustomComponent = ({ children }) => <div>{children}</div>;
      const App = () => (
        <CustomComponent css={styles}>With css reference</CustomComponent>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        background: blue;
        padding: 10px;
      }
      "
    `);
  });

  test('should allow custom components without css prop', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const CustomComponent = ({ children }) => <div>{children}</div>

        const App = () => (
          <CustomComponent className="some-class">
            This should work fine
          </CustomComponent>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const CustomComponent = ({ children }) => <div>{children}</div>;
      const App = () => (
        <CustomComponent className="some-class">
          This should work fine
        </CustomComponent>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('should handle css prop with spread props', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const StyledCard = styled.div\`
          padding: 20px;
        \`

        const App = () => {
          const props = { onClick: () => {} }
          return (
            <StyledCard
              css={\`
                border: 1px solid red;
              \`}
              {...props}
            >
              Content
            </StyledCard>
          )
        }
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { mergeClassNames } from "vindur";
      const App = () => {
        const props = {
          onClick: () => {},
        };
        return (
          <div
            {...props}
            className={mergeClassNames(
              [props],
              "v1560qbr-1-StyledCard v1560qbr-2-css-prop-2",
            )}
          >
            Content
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-StyledCard {
        padding: 20px;
      }

      .v1560qbr-2-css-prop-2 {
        border: 1px solid red;
      }
      "
    `);
  });

  test('should handle css prop after spread props', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const StyledCard = styled.div\`
          padding: 20px;
        \`

        const App = () => {
          const props = { onClick: () => {} }
          return (
            <StyledCard
              {...props}
              css={\`
                border: 1px solid red;
              \`}
            >
              Content
            </StyledCard>
          )
        }
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { mergeClassNames } from "vindur";
      const App = () => {
        const props = {
          onClick: () => {},
        };
        return (
          <div
            {...props}
            className={mergeClassNames(
              [props],
              "v1560qbr-1-StyledCard v1560qbr-2-css-prop-2",
            )}
          >
            Content
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-StyledCard {
        padding: 20px;
      }

      .v1560qbr-2-css-prop-2 {
        border: 1px solid red;
      }
      "
    `);
  });

  test('should throw error for invalid css prop value', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { css } from 'vindur'

          const invalidValue = { color: 'red' }

          const App = () => (
            <div css={invalidValue}>
              Content
            </div>
          )
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: Invalid css prop value. Only template literals and references to css function calls are supported
      loc: 6:12]
    `,
    );
  });
});
