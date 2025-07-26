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
      ".vmcre00-1 {
        background-color: red;
        padding: 10px;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return <div className="vmcre00-1" />;
      };"
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
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
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
        return <div>
            <button className="vcixwtu-1-Button">Click me</button>
            <h1 className="vcixwtu-2-Header">Title</h1>
          </div>;
      };"
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
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vi3fon9-1 {
        background-color: blue;
        padding: 12px;
        border: 1px solid gray;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const primaryColor = 'blue';
      const padding = 12;
      const App = () => <button className="vi3fon9-1">Click</button>;"
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
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
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
      "const Component = () => <div>
          <div className="v1012akl-1">div</div>
          <span className="v1012akl-2">span</span>
          <p className="v1012akl-3">p</p>
          <button className="v1012akl-4">button</button>
          <input className="v1012akl-5" />
        </div>;"
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
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /src/direct.ts: Inline styled component usage is not supported. Please assign styled components to a variable first.]`,
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
      fileAbsPath: '/src/debug.ts',
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vhqnxci-1 {
        color: blue;
        font-size: 16px;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const primaryColor = 'blue';
      const fontSize = 16;
      const App = () => <p className="vhqnxci-1">Hello</p>;"
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
      fileAbsPath: '/src/nested.ts',
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vmgoafb-1 {
        content: "my-value";
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const prefix = 'my';
      const suffix = 'value';
      const App = () => <div className="vmgoafb-1" />;"
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
        fileAbsPath: '/src/object.ts',
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /src/object.ts: Invalid interpolation used at \`... StyledDiv = styled\` ... \${theme.primary}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported]`,
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
        fileAbsPath: '/src/undefined.ts',
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /src/undefined.ts: Invalid interpolation used at \`... StyledDiv = styled\` ... \${undefinedVariable}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported]`,
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
      fileAbsPath: '/src/empty.ts',
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`""`);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <div className="v1v2q6wl-1" />;"
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
      fileAbsPath: '/src/special.ts',
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".viwoa2i-1 {
        content: "quotes \\"with\\" escapes";
        background: url('image.png');
        font-family: 'Font Name', sans-serif;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <div className="viwoa2i-1">Content</div>;"
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
      fileAbsPath: '/src/merge-class.ts',
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vylwivr-1 {
        background: blue;
        color: white;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <div>
          <button className="vylwivr-1 extra-class">Click me</button>
          <button className={\`vylwivr-1 \${\`dynamic-\${true ? 'active' : 'inactive'}\`}\`}>Dynamic</button>
        </div>;"
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
      fileAbsPath: '/src/extend.ts',
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
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
      "const App = () => <div>
          <button className="v4nysp2-1">Blue</button>
          <button className="v4nysp2-1 v4nysp2-2">Red</button>
        </div>;"
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
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /src/invalid-extend.ts: Cannot extend "notAStyledComponent": it is not a styled component. Only styled components can be extended.]`,
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
      fileAbsPath: '/src/spread-props.ts',
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vh89gjz-1 {
        background: blue;
        color: white;
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "const App = () => {
        const buttonProps = {
          onClick: () => {},
          disabled: false,
        };
        return (
          <button
            {...buttonProps}
            className={mergeClassNameWithSpreadProps([buttonProps], 'vh89gjz-1')}
          >
            Click me
          </button>
        );
      };"
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
      fileAbsPath: '/src/spread-individual.ts',
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vm54pe-1 {
        border: 1px solid gray;
        padding: 8px;
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeClassNameWithSpreadProps } from 'vindur';

      const App = () => {
        const inputProps = {
          type: 'text',
          placeholder: 'Enter text',
        };
        return (
          <input
            {...inputProps}
            value="test"
            onChange={() => {}}
            className={mergeClassNameWithSpreadProps(
              [inputProps],
              'vm54pe-1 extra-class',
            )}
          />
        );
      };"
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
      fileAbsPath: '/src/multiple-spread.ts',
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vbmwn6t-1 {
        display: flex;
        gap: 16px;
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeClassNameWithSpreadProps } from 'vindur';

      const App = () => {
        const styleProps = {
          style: {
            margin: '10px',
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
            className={mergeClassNameWithSpreadProps(
              [styleProps, eventProps],
              'vbmwn6t-1',
            )}
          >
            Content
          </div>
        );
      };"
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
      fileAbsPath: '/src/extended-spread.ts',
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vnzhx1v-1 {
        padding: 8px 16px;
        border: none;
      }

      .vnzhx1v-2 {
        background: blue;
        color: white;
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeClassNameWithSpreadProps } from 'vindur';

      const App = () => {
        const buttonProps = {
          type: 'submit',
          form: 'myForm',
        };
        return (
          <button
            {...buttonProps}
            onClick={() => console.log('clicked')}
            className={mergeClassNameWithSpreadProps(
              [buttonProps],
              'vnzhx1v-1 vnzhx1v-2',
            )}
          >
            Submit
          </button>
        );
      };"
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
      fileAbsPath: '/src/spread-classname.ts',
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1swlzlr-1 {
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeClassNameWithSpreadProps } from 'vindur';

      const App = () => {
        const cardProps = {
          className: 'animated-card fade-in',
          'data-testid': 'card-component',
        };
        return (
          <div
            {...cardProps}
            role="article"
            className={mergeClassNameWithSpreadProps([cardProps], 'v1swlzlr-1')}
          >
            Card content
          </div>
        );
      };"
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
      fileAbsPath: '/src/spread-order.ts',
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vwpl064-1 {
        background: gray;
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeClassNameWithSpreadProps } from 'vindur';

      const App = () => {
        const props1 = {
          className: 'first',
        };
        const props2 = {
          className: 'second',
        };
        return (
          <div
            className="before"
            {...props1}
            {...props2}
            className={mergeClassNameWithSpreadProps(
              [props1, props2],
              'vwpl064-1 after',
            )}
          >
            Content
          </div>
        );
      };"
    `);
  });

  test('should handle styled components with conditional spread props', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Button = styled.button\`
        background: blue;
      \`

      const App = ({ isDisabled, extraProps }) => {
        const baseProps = { type: 'button' }
        return (
          <Button 
            {...baseProps}
            {...(isDisabled && { disabled: true })}
            {...(extraProps || {})}
          >
            Click me
          </Button>
        )
      }
    `;

    const result = await transformWithFormat({
      source,
      fileAbsPath: '/src/conditional-spread.ts',
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vi0yc5y-1 {
        background: blue;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { mergeClassNameWithSpreadProps } from 'vindur';

      const App = ({ isDisabled, extraProps }) => {
        const baseProps = {
          type: 'button',
        };
        return (
          <button
            {...baseProps}
            {...(isDisabled && {
              disabled: true,
            })}
            {...(extraProps || {})}
            className={mergeClassNameWithSpreadProps(
              [
                baseProps,
                isDisabled && {
                  disabled: true,
                },
                extraProps || {},
              ],
              'vi0yc5y-1',
            )}
          >
            Click me
          </button>
        );
      };"
    `);
  });
});
