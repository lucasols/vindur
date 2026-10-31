import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('stable ID utilities in styled components', () => {
  test('should use stableId in styled component', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled, stableId } from 'vindur';

        export const id = stableId();
        export const Button = styled.button\`
          &[data-id="\${id}"] {
            color: red;
          }
          #\${id} {
            background: blue;
          }
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      export const id = "v1560qbr-1-id";
      export const Button = _vSC("button", "v1560qbr-2-Button");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-Button {
        &[data-id="v1560qbr-1-id"] {
          color: red;
        }
        #v1560qbr-1-id {
          background: blue;
        }
      }
      "
    `);
  });

  test('should use createClassName properties in styled component', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled, createClassName } from 'vindur';

        export const className = createClassName();
        export const Container = styled.div\`
          \${className.selector} {
            padding: 16px;
          }
          &.\${className.value} {
            margin: 8px;
          }
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      export const className = {
        selector: ".v1560qbr-1-className",
        value: "v1560qbr-1-className",
      };
      export const Container = _vSC("div", "v1560qbr-2-Container");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-Container {
        .v1560qbr-1-className {
          padding: 16px;
        }
        &.v1560qbr-1-className {
          margin: 8px;
        }
      }
      "
    `);
  });

  test('should use both stable utilities with createClassName properties in styled component', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled, stableId, createClassName } from 'vindur';

        export const id = stableId();
        export const className = createClassName();
        export const Card = styled.article\`
          #\${id} {
            font-size: 16px;
          }
          \${className.selector} {
            border: 1px solid gray;
          }
          &[data-id="\${id}"].\${className.value} {
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      export const id = "v1560qbr-1-id";
      export const className = {
        selector: ".v1560qbr-2-className",
        value: "v1560qbr-2-className",
      };
      export const Card = _vSC("article", "v1560qbr-3-Card");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-3-Card {
        #v1560qbr-1-id {
          font-size: 16px;
        }
        .v1560qbr-2-className {
          border: 1px solid gray;
        }
        &[data-id="v1560qbr-1-id"].v1560qbr-2-className {
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
      }
      "
    `);
  });
});

describe('stable ID utilities in CSS prop', () => {
  test('should use stableId in css prop', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { stableId } from 'vindur';

        export const id = stableId();

        export const Component = () => (
          <div css={\`
            #\${id} {
              color: red;
            }
            &[data-id="\${id}"] {
              background: blue;
            }
          \`}>
            Content
          </div>
        );
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const id = "v1560qbr-1-id";
      export const Component = () => (
        <div className="v1560qbr-2-css-prop-2">Content</div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-css-prop-2 {
        #v1560qbr-1-id {
          color: red;
        }
        &[data-id="v1560qbr-1-id"] {
          background: blue;
        }
      }
      "
    `);
  });

  test('should use createClassName properties in css prop', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createClassName } from 'vindur';

        export const className = createClassName();

        export const Component = () => (
          <div css={\`
            \${className.selector} {
              padding: 16px;
            }
            &.\${className.value} {
              margin: 8px;
            }
          \`}>
            Content
          </div>
        );
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const className = {
        selector: ".v1560qbr-1-className",
        value: "v1560qbr-1-className",
      };
      export const Component = () => (
        <div className="v1560qbr-2-css-prop-2">Content</div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-css-prop-2 {
        .v1560qbr-1-className {
          padding: 16px;
        }
        &.v1560qbr-1-className {
          margin: 8px;
        }
      }
      "
    `);
  });

  test('should use both stable utilities with createClassName properties in css prop', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { stableId, createClassName } from 'vindur';

        export const id = stableId();
        export const className = createClassName();

        export const Component = () => (
          <section css={\`
            #\${id} {
              font-size: 18px;
            }
            \${className.selector} {
              border: 2px solid navy;
            }
            &[data-id="\${id}"].\${className.value} {
              box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            }
          \`}>
            Content
          </section>
        );
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const id = "v1560qbr-1-id";
      export const className = {
        selector: ".v1560qbr-2-className",
        value: "v1560qbr-2-className",
      };
      export const Component = () => (
        <section className="v1560qbr-3-css-prop-3">Content</section>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-3-css-prop-3 {
        #v1560qbr-1-id {
          font-size: 18px;
        }
        .v1560qbr-2-className {
          border: 2px solid navy;
        }
        &[data-id="v1560qbr-1-id"].v1560qbr-2-className {
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }
      }
      "
    `);
  });

  test('should use createClassName properties across multiple css props', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { stableId, createClassName } from 'vindur';

        export const id = stableId();
        export const className = createClassName();

        export const Component = () => (
          <div>
            <header css={\`
              #\${id} {
                height: 60px;
              }
            \`}>
              Header
            </header>
            <main css={\`
              \${className.selector} {
                min-height: 400px;
              }
              &.\${className.value} {
                padding: 20px;
              }
            \`}>
              Main content
            </main>
          </div>
        );
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const id = "v1560qbr-1-id";
      export const className = {
        selector: ".v1560qbr-2-className",
        value: "v1560qbr-2-className",
      };
      export const Component = () => (
        <div>
          <header className="v1560qbr-3-css-prop-3">Header</header>
          <main className="v1560qbr-4-css-prop-4">Main content</main>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-3-css-prop-3 {
        #v1560qbr-1-id {
          height: 60px;
        }
      }

      .v1560qbr-4-css-prop-4 {
        .v1560qbr-2-className {
          min-height: 400px;
        }
        &.v1560qbr-2-className {
          padding: 20px;
        }
      }
      "
    `);
  });
});
