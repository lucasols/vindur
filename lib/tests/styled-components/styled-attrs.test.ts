import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

const importAliases = { '#/': '/' };
const emptyFs = createFsMock({});

describe('styled components - attrs functionality', () => {
  test('should handle styled.div.attrs({...}) with string attributes', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Container = styled.div.attrs({
        'data-testid': 'my-div',
        'aria-hidden': 'false',
      })\`
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
      "import { _vSC } from "vindur";
      const Container = _vSC("div", "v1560qbr-1-Container", {
        "data-testid": "my-div",
        "aria-hidden": "false",
      });
      const Component = () => {
        return <Container />;
      };
      "
    `);
  });

  test('should handle styled.div.attrs({...}) with mixed attribute types', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Input = styled.input.attrs({
        type: 'text',
        disabled: false,
        tabIndex: 0,
        'data-testid': 'test-input',
      })\`
        padding: 8px;
        border: 1px solid gray;
      \`

      const Component = () => {
        return <Input />;
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Input {
        padding: 8px;
        border: 1px solid gray;
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      const Input = _vSC("input", "v1560qbr-1-Input", {
        type: "text",
        disabled: false,
        tabIndex: 0,
        "data-testid": "test-input",
      });
      const Component = () => {
        return <Input />;
      };
      "
    `);
  });

  test('should handle exported styled components with attrs', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      export const Button = styled.button.attrs({
        type: 'button',
        role: 'button',
      })\`
        padding: 12px 24px;
        background: blue;
        color: white;
      \`

      const Component = () => {
        return <Button>Click me</Button>;
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 12px 24px;
        background: blue;
        color: white;
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      export const Button = _vSC("button", "v1560qbr-1-Button", {
        type: "button",
        role: "button",
      });
      const Component = () => {
        return <Button>Click me</Button>;
      };
      "
    `);
  });

  test('should handle styled(Component).attrs({...})', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const BaseButton = styled.button\`
        padding: 8px 16px;
        border: none;
      \`

      const PrimaryButton = styled(BaseButton).attrs({
        'data-variant': 'primary',
        'aria-pressed': 'false',
      })\`
        background: blue;
        color: white;
      \`

      const Component = () => {
        return <PrimaryButton>Click me</PrimaryButton>;
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
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      const PrimaryButton = _vSC(
        "button",
        "v1560qbr-1-BaseButton v1560qbr-2-PrimaryButton",
        {
          "data-variant": "primary",
          "aria-pressed": "false",
        },
      );
      const Component = () => {
        return <PrimaryButton>Click me</PrimaryButton>;
      };
      "
    `);
  });

  test('should handle exported styled extensions with attrs', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const BaseButton = styled.button\`
        padding: 8px 16px;
        border: none;
      \`

      export const PrimaryButton = styled(BaseButton).attrs({
        'data-variant': 'primary',
        role: 'button',
      })\`
        background: blue;
        color: white;
      \`

      const Component = () => {
        return <PrimaryButton>Click me</PrimaryButton>;
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
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      export const PrimaryButton = _vSC(
        "button",
        "v1560qbr-1-BaseButton v1560qbr-2-PrimaryButton",
        {
          "data-variant": "primary",
          role: "button",
        },
      );
      const Component = () => {
        return <PrimaryButton>Click me</PrimaryButton>;
      };
      "
    `);
  });

  test('should handle withComponent preserving attrs', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const BaseButton = styled.button.attrs({
        type: 'button',
        'data-testid': 'base-button',
      })\`
        padding: 8px 16px;
        border: none;
      \`

      export const LinkButton = BaseButton.withComponent('a')

      const Component = () => {
        return <LinkButton href="/test">Link</LinkButton>;
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
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      const BaseButton = _vSC("button", "v1560qbr-1-BaseButton", {
        type: "button",
        "data-testid": "base-button",
      });
      export const LinkButton = _vSC("a", "v1560qbr-1-BaseButton", {
        type: "button",
        "data-testid": "base-button",
      });
      const Component = () => {
        return <LinkButton href="/test">Link</LinkButton>;
      };
      "
    `);
  });

  test('should handle style flags with attrs', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      export const Button = styled.button.attrs({
        type: 'button',
        'data-component': 'button',
      })<{ active: boolean; size: 'small' | 'large' }>\`
        padding: 8px 16px;
        background: gray;

        &.active {
          background: blue;
        }

        &.size-small {
          padding: 4px 8px;
        }

        &.size-large {
          padding: 12px 24px;
        }
      \`

      const Component = () => {
        return <Button active size="small">Click me</Button>;
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
        background: gray;

        &.voctcyj-active {
          background: blue;
        }

        &.vr4ikfs-size-small {
          padding: 4px 8px;
        }

        &.vr4ikfs-size-large {
          padding: 12px 24px;
        }
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vCWM } from "vindur";
      export const Button = _vCWM(
        [
          ["active", "voctcyj-active"],
          ["size", "vr4ikfs-size"],
        ],
        "v1560qbr-1-Button",
        "button",
        {
          type: "button",
          "data-component": "button",
        },
      );
      const Component = () => {
        return (
          <Button active size="small">
            Click me
          </Button>
        );
      };
      "
    `);
  });

  test('should handle dynamic attrs values', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const dynamicValue = 'test'

      const Container = styled.div.attrs({
        'data-testid': dynamicValue,
      })\`
        background-color: red;
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
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      const dynamicValue = "test";
      const Container = _vSC("div", "v1560qbr-1-Container", {
        "data-testid": dynamicValue,
      });
      const Component = () => {
        return <Container />;
      };
      "
    `);
  });

  test('should throw error for non-object attrs argument', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Container = styled.div.attrs('invalid')\`
        background-color: red;
      \`
    `;

    await expect(async () => {
      await transformWithFormat({
        source,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: styled.*.attrs() must be called with exactly one object literal argument]`,
    );
  });

  test('should throw error for multiple attrs arguments', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Container = styled.div.attrs({}, {})\`
        background-color: red;
      \`
    `;

    await expect(async () => {
      await transformWithFormat({
        source,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: styled.*.attrs() must be called with exactly one object literal argument]`,
    );
  });

  test('should handle function calls and expressions in attrs', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const getTestId = () => 'my-component'
      const baseSize = 10

      const Container = styled.div.attrs({
        'data-testid': getTestId(),
        'data-size': baseSize * 2,
        'aria-hidden': Math.random() > 0.5,
      })\`
        background-color: red;
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
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      const getTestId = () => "my-component";
      const baseSize = 10;
      const Container = _vSC("div", "v1560qbr-1-Container", {
        "data-testid": getTestId(),
        "data-size": baseSize * 2,
        "aria-hidden": Math.random() > 0.5,
      });
      const Component = () => {
        return <Container />;
      };
      "
    `);
  });

  test('should handle object property access and complex expressions in attrs', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const config = { testId: 'my-component', enabled: true }
      const theme = { sizes: { small: 8, large: 16 } }

      const Container = styled.div.attrs({
        'data-testid': config.testId,
        'aria-expanded': config.enabled,
        'data-size': theme.sizes.small,
        role: config.enabled ? 'button' : 'presentation',
      })\`
        background-color: red;
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
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      const config = {
        testId: "my-component",
        enabled: true,
      };
      const theme = {
        sizes: {
          small: 8,
          large: 16,
        },
      };
      const Container = _vSC("div", "v1560qbr-1-Container", {
        "data-testid": config.testId,
        "aria-expanded": config.enabled,
        "data-size": theme.sizes.small,
        role: config.enabled ? "button" : "presentation",
      });
      const Component = () => {
        return <Container />;
      };
      "
    `);
  });

  test('should handle string literal keys in attrs', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const Container = styled.div.attrs({
        'data-test-id': 'container',
        'aria-hidden': 'true',
      })\`
        background-color: red;
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
      }
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      const Container = _vSC("div", "v1560qbr-1-Container", {
        "data-test-id": "container",
        "aria-hidden": "true",
      });
      const Component = () => {
        return <Container />;
      };
      "
    `);
  });
});
