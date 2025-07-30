import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

const importAliases = { '#/': '/' };
const emptyFs = createFsMock({});

describe('withComponent', () => {
  test('should change element type while keeping styles', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Button = styled.button\`
          padding: 10px;
          background: blue;
        \`

        const Link = Button.withComponent('a')

        const App = () => (
          <div>
            <Button>Button</Button>
            <Link>Link</Link>
          </div>
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div>
          <button className="v1560qbr-1-Button">Button</button>
          <a className="v1560qbr-1-Button">Link</a>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 10px;
        background: blue;
      }
      "
    `);
  });

  test('should work with exported styled components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled, _vSC } from 'vindur'

        export const Button = styled.button\`
          padding: 10px;
          background: blue;
        \`

        export const Link = Button.withComponent('a')

        const App = () => (
          <div>
            <Button>Button</Button>
            <Link>Link</Link>
          </div>
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      export const Button = _vSC("button", "v1560qbr-1-Button");
      export const Link = _vSC("a", "v1560qbr-1-Button");
      const App = () => (
        <div>
          <Button>Button</Button>
          <Link>Link</Link>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 10px;
        background: blue;
      }
      "
    `);
  });

  test('should work with chained withComponent calls', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Button = styled.button\`
          padding: 10px;
          background: blue;
        \`

        const Link = Button.withComponent('a')
        const Span = Link.withComponent('span')

        const App = () => (
          <div>
            <Button>Button</Button>
            <Link>Link</Link>
            <Span>Span</Span>
          </div>
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div>
          <button className="v1560qbr-1-Button">Button</button>
          <a className="v1560qbr-1-Button">Link</a>
          <span className="v1560qbr-1-Button">Span</span>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 10px;
        background: blue;
      }
      "
    `);
  });

  test('should work with components that have style flags', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled, _vCWM } from 'vindur'

        export const Button = styled.button<{ active: boolean }>\`
          padding: 10px;
          background: blue;
  
          &.active {
            background: red;
          }
        \`

        export const Link = Button.withComponent('a')

        const App = () => (
          <div>
            <Button active>Button</Button>
            <Link active>Link</Link>
          </div>
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vCWM } from "vindur";
      export const Button = _vCWM(
        [["active", "voctcyj-active"]],
        "v1560qbr-1-Button",
        "button",
      );
      export const Link = _vCWM(
        [["active", "voctcyj-active"]],
        "v1560qbr-1-Button",
        "a",
      );
      const App = () => (
        <div>
          <Button active>Button</Button>
          <Link active>Link</Link>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 10px;
        background: blue;

        &.voctcyj-active {
          background: red;
        }
      }
      "
    `);
  });

  test('should throw error when calling withComponent on non-styled component', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const notAStyledComponent = 'regular-variable'
          const FailedWithComponent = notAStyledComponent.withComponent('div')
        `,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: Cannot call withComponent on "notAStyledComponent": it is not a styled component.]`,
    );
  });

  test('should throw error when withComponent argument is not a string literal or identifier', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Button = styled.button\`color: blue\`
          const FailedWithComponent = Button.withComponent({ toString: () => 'div' })
        `,
        overrideDefaultFs: emptyFs,
        overrideDefaultImportAliases: importAliases,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: withComponent() must be called with either a string literal element name or a component identifier.]`,
    );
  });

  test('should work with extended styled components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const BaseButton = styled.button\`
          padding: 8px;
          background: blue;
        \`

        const RedButton = styled(BaseButton)\`
          background: red;
        \`

        const RedLink = RedButton.withComponent('a')

        const App = () => (
          <div>
            <BaseButton>Base</BaseButton>
            <RedButton>Red Button</RedButton>
            <RedLink>Red Link</RedLink>
          </div>
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div>
          <button className="v1560qbr-1-BaseButton">Base</button>
          <button className="v1560qbr-1-BaseButton v1560qbr-2-RedButton">
            Red Button
          </button>
          <a className="v1560qbr-1-BaseButton v1560qbr-2-RedButton">Red Link</a>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-BaseButton {
        padding: 8px;
        background: blue;
      }

      .v1560qbr-2-RedButton {
        background: red;
      }
      "
    `);
  });

  test('should work with custom components for non-exported styled components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const MyCustomComponent = ({ className, children }) => (
          <div className={className + ' custom-class'}>{children}</div>
        )

        const Button = styled.button\`
          padding: 10px;
          background: blue;
        \`

        const CustomButton = Button.withComponent(MyCustomComponent)

        const App = () => (
          <div>
            <Button>Original Button</Button>
            <CustomButton>Custom Button</CustomButton>
          </div>
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const MyCustomComponent = ({ className, children }) => (
        <div className={className + " custom-class"}>{children}</div>
      );
      const App = () => (
        <div>
          <button className="v1560qbr-1-Button">Original Button</button>
          <MyCustomComponent className="v1560qbr-1-Button">
            Custom Button
          </MyCustomComponent>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 10px;
        background: blue;
      }
      "
    `);
  });

  test('should work with custom components for exported styled components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled, _vSC } from 'vindur'

        const MyCustomComponent = ({ className, children }) => (
          <div className={className + ' custom-class'}>{children}</div>
        )

        export const Button = styled.button\`
          padding: 10px;
          background: blue;
        \`

        export const CustomButton = Button.withComponent(MyCustomComponent)

        const App = () => (
          <div>
            <Button>Original Button</Button>
            <CustomButton>Custom Button</CustomButton>
          </div>
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      const MyCustomComponent = ({ className, children }) => (
        <div className={className + " custom-class"}>{children}</div>
      );
      export const Button = _vSC("button", "v1560qbr-1-Button");
      export const CustomButton = _vSC(MyCustomComponent, "v1560qbr-1-Button");
      const App = () => (
        <div>
          <Button>Original Button</Button>
          <CustomButton>Custom Button</CustomButton>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 10px;
        background: blue;
      }
      "
    `);
  });

  test('should work with custom components and style flags', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled, _vCWM } from 'vindur'

        const MyCustomComponent = ({ className, children, active }) => (
          <div className={className + (active ? ' active-custom' : '')}>{children}</div>
        )

        export const Button = styled.button<{ active: boolean }>\`
          padding: 10px;
          background: blue;
  
          &.active {
            background: red;
          }
        \`

        export const CustomButton = Button.withComponent(MyCustomComponent)

        const App = () => (
          <div>
            <Button active>Original Button</Button>
            <CustomButton active>Custom Button</CustomButton>
          </div>
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vCWM } from "vindur";
      const MyCustomComponent = ({ className, children, active }) => (
        <div className={className + (active ? " active-custom" : "")}>{children}</div>
      );
      export const Button = _vCWM(
        [["active", "voctcyj-active"]],
        "v1560qbr-1-Button",
        "button",
      );
      export const CustomButton = _vCWM(
        [["active", "voctcyj-active"]],
        "v1560qbr-1-Button",
        MyCustomComponent,
      );
      const App = () => (
        <div>
          <Button active>Original Button</Button>
          <CustomButton active>Custom Button</CustomButton>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 10px;
        background: blue;

        &.voctcyj-active {
          background: red;
        }
      }
      "
    `);
  });
});
