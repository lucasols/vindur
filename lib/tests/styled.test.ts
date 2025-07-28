import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, formatCode, transformWithFormat } from './testUtils';

const importAliases = { '#/': '/' };
const emptyFs = createFsMock({});

describe('styled components', () => {
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
      }"
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
      }"
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
      }"
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
      }"
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
      `[Error: /test.tsx: Inline styled component usage is not supported. Please assign styled components to a variable first.]`,
    );
  });
});

describe('styled components interpolation', () => {
  test('should resolve simple variables at compile time', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const primaryColor = 'blue'
      const fontSize = 16

      const StyledText = styled.p\`
        color: \${primaryColor};
        font-size: \${fontSize}px;
      \`

      const App = () => <StyledText>Hello</StyledText>
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-StyledText {
        color: blue;
        font-size: 16px;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const primaryColor = "blue";
      const fontSize = 16;
      const App = () => <p className="v1560qbr-1-StyledText">Hello</p>;
      "
    `);
  });

  test('should handle nested template literals', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const prefix = 'my'
      const suffix = 'value'

      const StyledDiv = styled.div\`
        content: "\${prefix}-\${suffix}";
      \`

      const App = () => <StyledDiv />
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-StyledDiv {
        content: "my-value";
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const prefix = "my";
      const suffix = "value";
      const App = () => <div className="v1560qbr-1-StyledDiv" />;
      "
    `);
  });
});

describe('styled components error handling', () => {
  test('should throw error for object property access', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const theme = { primary: 'blue' }
      const StyledDiv = styled.div\`
        color: \${theme.primary};
      \`
    `;

    await expect(async () => {
      await transformWithFormat({
        source,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: Invalid interpolation used at \`... StyledDiv = styled\` ... \${theme.primary}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported]`,
    );
  });

  test('should throw error for undefined variable references', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const StyledDiv = styled.div\`
        color: \${undefinedVariable};
      \`
    `;

    await expect(async () => {
      await transformWithFormat({
        source,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: Invalid interpolation used at \`... StyledDiv = styled\` ... \${undefinedVariable}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported]`,
    );
  });
});

describe('styled components corner cases', () => {
  test('should handle empty styled templates', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const EmptyStyled = styled.div\`\`

      const App = () => <EmptyStyled />
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`""`);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <div className="v1560qbr-1-EmptyStyled" />;
      "
    `);
  });

  test('should handle styled components with special characters', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const StyledDiv = styled.div\`
        content: "quotes \\"with\\" escapes";
        background: url('image.png');
        font-family: 'Font Name', sans-serif;
      \`

      const App = () => <StyledDiv>Content</StyledDiv>
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-StyledDiv {
        content: "quotes \\"with\\" escapes";
        background: url('image.png');
        font-family: 'Font Name', sans-serif;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <div className="v1560qbr-1-StyledDiv">Content</div>;
      "
    `);
  });

  test('should merge className when styled component already has className', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const StyledButton = styled.button\`
        background: blue;
        color: white;
      \`

      const App = () => (
        <div>
          <StyledButton className="extra-class">Click me</StyledButton>
          <StyledButton className={\`dynamic-\${true ? 'active' : 'inactive'}\`}>Dynamic</StyledButton>
        </div>
      )
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-StyledButton {
        background: blue;
        color: white;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div>
          <button className="v1560qbr-1-StyledButton extra-class">Click me</button>
          <button
            className={\`v1560qbr-1-StyledButton \${\`dynamic-\${true ? "active" : "inactive"}\`}\`}
          >
            Dynamic
          </button>
        </div>
      );
      "
    `);
  });
});

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
      }"
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
      `[Error: /test.tsx: Cannot extend "notAStyledComponent": it is not a styled component. Only styled components can be extended.]`,
    );
  });
});

describe('handle spread props', () => {
  test('should handle styled components with spread props', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Button = styled.button\`
        background: blue;
        color: white;
      \`

      const App = () => {
        const buttonProps = { onClick: () => {}, disabled: false }
        return <Button {...buttonProps}>Click me</Button>
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: blue;
        color: white;
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeClassNames } from "vindur";
      const App = () => {
        const buttonProps = {
          onClick: () => {},
          disabled: false,
        };
        return (
          <button
            {...buttonProps}
            className={mergeClassNames([buttonProps], "v1560qbr-1-Button")}
          >
            Click me
          </button>
        );
      };
      "
    `);
  });

  test('should handle styled components with both spread props and individual props', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Input = styled.input\`
        border: 1px solid gray;
        padding: 8px;
      \`

      const App = () => {
        const inputProps = { type: 'text', placeholder: 'Enter text' }
        return (
          <Input 
            {...inputProps}
            value="test"
            onChange={() => {}}
            className="extra-class"
          />
        )
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Input {
        border: 1px solid gray;
        padding: 8px;
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "const App = () => {
        const inputProps = {
          type: "text",
          placeholder: "Enter text",
        };
        return (
          <input
            {...inputProps}
            value="test"
            onChange={() => {}}
            className="v1560qbr-1-Input extra-class"
          />
        );
      };
      "
    `);
  });

  test('should handle styled components with multiple spread props', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Div = styled.div\`
        display: flex;
        gap: 16px;
      \`

      const App = () => {
        const styleProps = { style: { margin: '10px' } }
        const eventProps = { onClick: () => {}, onMouseOver: () => {} }
        return (
          <Div 
            {...styleProps}
            {...eventProps}
            id="container"
          >
            Content
          </Div>
        )
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Div {
        display: flex;
        gap: 16px;
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeClassNames } from "vindur";
      const App = () => {
        const styleProps = {
          style: {
            margin: "10px",
          },
        };
        const eventProps = {
          onClick: () => {},
          onMouseOver: () => {},
        };
        return (
          <div
            {...styleProps}
            {...eventProps}
            id="container"
            className={mergeClassNames([styleProps, eventProps], "v1560qbr-1-Div")}
          >
            Content
          </div>
        );
      };
      "
    `);
  });

  test('should handle extended styled components with spread props', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const BaseButton = styled.button\`
        padding: 8px 16px;
        border: none;
      \`

      const PrimaryButton = styled(BaseButton)\`
        background: blue;
        color: white;
      \`

      const App = () => {
        const buttonProps = { type: 'submit', form: 'myForm' }
        return (
          <PrimaryButton 
            {...buttonProps}
            onClick={() => console.log('clicked')}
          >
            Submit
          </PrimaryButton>
        )
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-BaseButton {
        padding: 8px 16px;
        border: none;
      }

      .v1560qbr-2-PrimaryButton {
        background: blue;
        color: white;
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeClassNames } from "vindur";
      const App = () => {
        const buttonProps = {
          type: "submit",
          form: "myForm",
        };
        return (
          <button
            {...buttonProps}
            onClick={() => console.log("clicked")}
            className={mergeClassNames(
              [buttonProps],
              "v1560qbr-1-BaseButton v1560qbr-2-PrimaryButton",
            )}
          >
            Submit
          </button>
        );
      };
      "
    `);
  });

  test('should handle styled components with spread props and className merge', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Card = styled.div\`
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      \`

      const App = () => {
        const cardProps = { 
          className: 'animated-card fade-in',
          'data-testid': 'card-component'
        }
        return (
          <Card 
            {...cardProps}
            role="article"
          >
            Card content
          </Card>
        )
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeClassNames } from "vindur";
      const App = () => {
        const cardProps = {
          className: "animated-card fade-in",
          "data-testid": "card-component",
        };
        return (
          <div
            {...cardProps}
            role="article"
            className={mergeClassNames([cardProps], "v1560qbr-1-Card")}
          >
            Card content
          </div>
        );
      };
      "
    `);
  });

  test('should preserve spread prop order with className', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Box = styled.div\`
        background: gray;
      \`

      const App = () => {
        const props1 = { className: 'first' }
        const props2 = { className: 'second' }
        return (
          <Box 
            className="before"
            {...props1}
            {...props2}
            className="after"
          >
            Content
          </Box>
        )
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Box {
        background: gray;
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "const App = () => {
        const props1 = {
          className: "first",
        };
        const props2 = {
          className: "second",
        };
        return (
          <div {...props1} {...props2} className="v1560qbr-1-Box after">
            Content
          </div>
        );
      };
      "
    `);
  });
});
