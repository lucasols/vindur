import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { formatCode, transformWithFormat } from './testUtils';

describe('handle spread props', () => {
  test('spread props without className override', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Button = styled.button\`
          background: blue;
          color: white;
        \`

        const App = () => {
          const buttonProps = { onClick: () => {}, disabled: false }
          return <Button {...buttonProps}>Click me</Button>
        }
      `,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: blue;
        color: white;
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeWithSpread } from "vindur";
      const App = () => {
        const buttonProps = {
          onClick: () => {},
          disabled: false,
        };
        return (
          <button
            {...buttonProps}
            className={mergeWithSpread([buttonProps], "v1560qbr-1")}
          >
            Click me
          </button>
        );
      };
      "
    `);
  });

  test('className prop overrides spread props (no need to use merge util)', async () => {
    const result = await transformWithFormat({
      source: dedent`
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
      `,
    });

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
            className="v1560qbr-1 extra-class"
          />
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        border: 1px solid gray;
        padding: 8px;
      }"
    `);
  });

  test('multiple spread props without className override', async () => {
    const result = await transformWithFormat({
      source: dedent`
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
      `,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        display: flex;
        gap: 16px;
      }"
    `);

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeWithSpread } from "vindur";
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
            className={mergeWithSpread([styleProps, eventProps], "v1560qbr-1")}
          >
            Content
          </div>
        );
      };
      "
    `);
  });

  test('extended components with spread props', async () => {
    const result = await transformWithFormat({
      source: dedent`
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
      `,
    });

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeWithSpread } from "vindur";
      const App = () => {
        const buttonProps = {
          type: "submit",
          form: "myForm",
        };
        return (
          <button
            {...buttonProps}
            onClick={() => console.log("clicked")}
            className={mergeWithSpread([buttonProps], "v1560qbr-1 v1560qbr-2")}
          >
            Submit
          </button>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        padding: 8px 16px;
        border: none;
      }

      .v1560qbr-2 {
        background: blue;
        color: white;
      }"
    `);
  });

  test('spread props contain className', async () => {
    const result = await transformWithFormat({
      source: dedent`
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
      `,
    });

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeWithSpread } from "vindur";
      const App = () => {
        const cardProps = {
          className: "animated-card fade-in",
          "data-testid": "card-component",
        };
        return (
          <div
            {...cardProps}
            role="article"
            className={mergeWithSpread([cardProps], "v1560qbr-1")}
          >
            Card content
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }"
    `);
  });

  test('final className prop overrides everything', async () => {
    const result = await transformWithFormat({
      source: dedent`
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
      `,
    });

    expect(await formatCode(result.code)).toMatchInlineSnapshot(`
      "import { mergeWithSpread } from "vindur";
      const App = () => {
        const props1 = {
          className: "first",
        };
        const props2 = {
          className: "second",
        };
        return (
          <div
            className="before"
            {...props1}
            {...props2}
            className={mergeWithSpread([props1, props2], "v1560qbr-1 after")}
          >
            Content
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: gray;
      }"
    `);
  });

  test('conditional spread expressions should throw error', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
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
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [Error: /test.tsx: Unsupported spread expression "isDisabled && {
        disabled: true
      }" used in vindur styled component. Only references to variables are allowed in spread expressions. Extract them to a variable and use that variable in the spread expression.]
    `);
  });
});
