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
      `
      [TransformError: /test.tsx: Cannot call withComponent on "notAStyledComponent": it is not a styled component.
      loc: 4:28]
    `,
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
      `
      [TransformError: /test.tsx: withComponent() must be called with either a string literal element name or a component identifier.
      loc: 4:49]
    `,
    );
  });

  test('should throw error when withComponent is not the initializer of a top-level variable', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'
          import { Menu } from '#/components'

          const Container = styled.div\`
            color: red;
          \`

          export const App = () => <Menu container={Container.withComponent('span')} />
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: "Container.withComponent()" must be assigned directly to a top-level variable, e.g. \`const Link = Container.withComponent('a')\`
      loc: 8:42]
    `,
    );
  });

  test('should throw error when withComponent is called inside a function', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Container = styled.div\`
            color: red;
          \`

          export function App() {
            const Link = Container.withComponent('a')
            return <Link />
          }
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: "Container.withComponent()" must be assigned directly to a top-level variable, e.g. \`const Link = Container.withComponent('a')\`
      loc: 8:15]
    `,
    );
  });

  test('should throw error when withComponent shares its variable declaration', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Container = styled.div\`
            color: red;
          \`

          const Link = Container.withComponent('a'), title = 'hello'

          export const App = () => <Link>{title}</Link>
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: withComponent() must use its own variable declaration
      loc: 7:0]
    `);
  });

  test('should throw error when withComponent calls are chained', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Container = styled.div\`
            color: red;
          \`

          const Link = Container.withComponent('a').withComponent('span')

          export const App = () => <Link />
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: "Container.withComponent()" must be assigned directly to a top-level variable, e.g. \`const Link = Container.withComponent('a')\`
      loc: 7:13]
    `);
  });

  test('should throw error when withComponent is assigned to a destructuring pattern', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Container = styled.div\`
            color: red;
          \`

          const { displayName } = Container.withComponent('a')
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: "Container.withComponent()" must be assigned directly to a top-level variable, e.g. \`const Link = Container.withComponent('a')\`
      loc: 7:24]
    `);
  });

  test('should throw error when withComponent is called on a parenthesized or computed reference', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Container = styled.div\`
            color: red;
          \`

          const Link = (Container).withComponent('a')
          const Section = Container['withComponent']('section')
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: "Container.withComponent()" must be assigned directly to a top-level variable, e.g. \`const Link = Container.withComponent('a')\`
      loc: 7:13]
    `);

    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Container = styled.div\`
            color: red;
          \`

          const Section = Container['withComponent']('section')
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: "Container.withComponent()" must be assigned directly to a top-level variable, e.g. \`const Link = Container.withComponent('a')\`
      loc: 7:16]
    `);
  });

  test('should throw error when withComponent is referenced without being called', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Container = styled.div\`
            color: red;
          \`

          export const getWithComponent = () => Container.withComponent
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: "Container.withComponent()" must be assigned directly to a top-level variable, e.g. \`const Link = Container.withComponent('a')\`
      loc: 7:38]
    `);
  });

  test('should work with a parenthesized withComponent initializer', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Container = styled.div\`
          color: red;
        \`

        const Link = (Container.withComponent('a'))

        export const App = () => <Link />
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const App = () => <a className="v1560qbr-1-Container" />;
      "
    `);
  });

  test('should not check withComponent methods of other local bindings', async () => {
    const result = await transformWithFormat({
      source: dedent`
        const registry = { withComponent: (value: string) => value }

        export function App() {
          return registry.withComponent('a')
        }
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const registry = {
        withComponent: (value: string) => value,
      };
      export function App() {
        return registry.withComponent("a");
      }
      "
    `);
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

  test('should share cx modifier classes with the base component', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Button = styled.button\`
          padding: 10px;

          &.active {
            background: red;
          }
        \`

        const Link = Button.withComponent('a')

        const App = ({ on }) => (
          <div>
            <Button cx={{ active: on }}>Button</Button>
            <Link cx={{ active: on }}>Link</Link>
          </div>
        )
      `,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = ({ on }) => (
        <div>
          <button className={"v1560qbr-1-Button" + (on ? " v1560qbr-2-active" : "")}>
            Button
          </button>
          <a className={"v1560qbr-1-Button" + (on ? " v1560qbr-2-active" : "")}>
            Link
          </a>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 10px;

        &.v1560qbr-2-active {
          background: red;
        }
      }
      "
    `);
  });
});

test('should error on withComponent sharing a variable declaration', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Button = styled.button\`
          padding: 10px;
        \`;

        const size = 2, Link = Button.withComponent('a');

        export const App = () => <Link>{size}</Link>;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: withComponent() must use its own variable declaration
    loc: 7:0]
  `);
});

test('should throw for withComponent of a component with a style flag of the base', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { Item } from '#/item'

        const Base = styled.div<{ active: boolean }>\`&.active { color: blue; }\`
        const LinkedItem = Base.withComponent(Item)

        export const App = () => <LinkedItem active />
      `,
      overrideDefaultFs: createFsMock({
        'item.tsx': dedent`
          import { styled } from 'vindur'

          export const Item = styled.div<{ active: boolean }>\`&.active { color: red; }\`
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag \`active\` of \`Base\` is also a style flag of \`Item\`, which would no longer get the prop, rename one of them
    loc: 5:38]
  `);
});
