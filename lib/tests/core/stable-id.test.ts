import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('stableId', () => {
  test('should transform stableId() call to stable hash', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { stableId } from 'vindur';

        export const myId = stableId();
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const myId = "v1560qbr-myId-1";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('should generate different hashes for multiple stableId calls', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { stableId } from 'vindur';

        export const firstId = stableId();
        export const secondId = stableId();
        export const thirdId = stableId();
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const firstId = "v1560qbr-firstId-1";
      export const secondId = "v1560qbr-secondId-2";
      export const thirdId = "v1560qbr-thirdId-3";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('should work in dev mode', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { stableId } from 'vindur';

        export const myId = stableId();
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const myId = "v1560qbr-myId-1";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('should work with inline usage', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { stableId } from 'vindur';

        const Component = () => {
          return <div id={stableId()}>Content</div>;
        };
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return <div id={"v1560qbr-1"}>Content</div>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('should not transform stableId if not imported', async () => {
    const result = await transformWithFormat({
      source: dedent`
        const stableId = () => 'custom';
        export const myId = stableId();
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const stableId = () => "custom";
      export const myId = stableId();
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });
});

describe('createClassName', () => {
  test('should transform createClassName() call to object with selector and value', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createClassName } from 'vindur';

        export const myClassName = createClassName();
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const myClassName = createClassName("v1560qbr-myClassName-1");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('should generate different hashes for multiple createClassName calls', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createClassName } from 'vindur';

        export const firstClassName = createClassName();
        export const secondClassName = createClassName();
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const firstClassName = createClassName("v1560qbr-firstClassName-1");
      export const secondClassName = createClassName("v1560qbr-secondClassName-2");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('should work in dev mode', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createClassName } from 'vindur';

        export const myClassName = createClassName();
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const myClassName = createClassName("v1560qbr-myClassName-1");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('should throw error with object destructuring', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createClassName } from 'vindur';

          export const { selector, value } = createClassName();
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: createClassName() cannot be used with destructuring assignment. Use a regular variable assignment instead.]`,
    );
  });

  test('should throw error with inline usage inside functions', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createClassName } from 'vindur';

          const Component = () => {
            const className = createClassName();
            return (
              <div className={className.value}>
                Content
              </div>
            );
          };
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: createClassName() can only be used in variable declarations at the module root level.]`,
    );
  });

  test('should not transform createClassName if not imported', async () => {
    const result = await transformWithFormat({
      source: dedent`
        const createClassName = () => ({ selector: '.custom', value: 'custom' });
        export const myClassName = createClassName();
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const createClassName = () => ({
        selector: ".custom",
        value: "custom",
      });
      export const myClassName = createClassName();
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('should throw error when used as function argument', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createClassName } from 'vindur';

          export const result = someFunction(createClassName());
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: createClassName() can only be used in variable declarations at the module root level, not inline.]`,
    );
  });

  test('should throw error when used in object property', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createClassName } from 'vindur';

          export const config = {
            className: createClassName(),
          };
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: createClassName() can only be used in variable declarations at the module root level, not inline.]`,
    );
  });

  test('should throw error when used in array', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createClassName } from 'vindur';

          export const classNames = [createClassName()];
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: createClassName() can only be used in variable declarations at the module root level, not inline.]`,
    );
  });
});

describe('mixed stable ID utilities', () => {
  test('should handle both stableId and createClassName in same file', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { stableId, createClassName } from 'vindur';

        export const id = stableId();
        export const className = createClassName();
        export const anotherId = stableId();
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const id = "v1560qbr-id-1";
      export const className = createClassName("v1560qbr-className-2");
      export const anotherId = "v1560qbr-anotherId-3";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('should work with css function and maintain consistent counter', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, stableId, createClassName } from 'vindur';

        export const style1 = css\`color: red;\`;
        export const id = stableId();
        export const className = createClassName();
        export const style2 = css\`color: blue;\`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const style1 = "v1560qbr-1-style1";
      export const id = "v1560qbr-id-2";
      export const className = createClassName("v1560qbr-className-3");
      export const style2 = "v1560qbr-4-style2";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style1 {
        color: red;
      }

      .v1560qbr-4-style2 {
        color: blue;
      }"
    `);
  });
});

describe('stable ID utilities in CSS context', () => {
  test('should use stableId in css template', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, stableId } from 'vindur';

        export const id = stableId();
        export const style = css\`
          #\${id} {
            color: red;
          }
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const id = "v1560qbr-id-1";
      export const style = "v1560qbr-2-style";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-style {
        #v1560qbr-id-1 {
          color: red;
        }
      }"
    `);
  });

  test('should use createClassName properties in css template', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, createClassName } from 'vindur';

        export const className = createClassName();
        export const style = css\`
          \${className.selector} {
            background: blue;
          }
          .\${className.value} {
            border: 1px solid black;
          }
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const className = createClassName("v1560qbr-className-1");
      export const style = "v1560qbr-2-style";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-style {
        .v1560qbr-className-1 {
          background: blue;
        }
        .v1560qbr-className-1 {
          border: 1px solid black;
        }
      }"
    `);
  });

  test('should use both stableId and createClassName properties in css template', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, stableId, createClassName } from 'vindur';

        export const id = stableId();
        export const className = createClassName();
        export const style = css\`
          #\${id} {
            color: red;
          }
          \${className.selector} {
            background: blue;
          }
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const id = "v1560qbr-id-1";
      export const className = createClassName("v1560qbr-className-2");
      export const style = "v1560qbr-3-style";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-3-style {
        #v1560qbr-id-1 {
          color: red;
        }
        .v1560qbr-className-2 {
          background: blue;
        }
      }"
    `);
  });
});

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
      "import { styledComponent } from "vindur";
      export const id = "v1560qbr-id-1";
      export const Button = styledComponent("button", "v1560qbr-2-Button");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-Button {
        &[data-id="v1560qbr-id-1"] {
          color: red;
        }
        #v1560qbr-id-1 {
          background: blue;
        }
      }"
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
      "import { styledComponent } from "vindur";
      export const className = createClassName("v1560qbr-className-1");
      export const Container = styledComponent("div", "v1560qbr-2-Container");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-Container {
        .v1560qbr-className-1 {
          padding: 16px;
        }
        &.v1560qbr-className-1 {
          margin: 8px;
        }
      }"
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
      "import { styledComponent } from "vindur";
      export const id = "v1560qbr-id-1";
      export const className = createClassName("v1560qbr-className-2");
      export const Card = styledComponent("article", "v1560qbr-3-Card");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-3-Card {
        #v1560qbr-id-1 {
          font-size: 16px;
        }
        .v1560qbr-className-2 {
          border: 1px solid gray;
        }
        &[data-id="v1560qbr-id-1"].v1560qbr-className-2 {
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
      }"
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
      "export const id = "v1560qbr-id-1";
      export const Component = () => (
        <div className="v1560qbr-2-css-prop-2">Content</div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-css-prop-2 {
        #v1560qbr-id-1 {
            color: red;
          }
          &[data-id="v1560qbr-id-1"] {
            background: blue;
          }
      }"
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
      "export const className = createClassName("v1560qbr-className-1");
      export const Component = () => (
        <div className="v1560qbr-2-css-prop-2">Content</div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-css-prop-2 {
        .v1560qbr-className-1 {
            padding: 16px;
          }
          &.v1560qbr-className-1 {
            margin: 8px;
          }
      }"
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
      "export const id = "v1560qbr-id-1";
      export const className = createClassName("v1560qbr-className-2");
      export const Component = () => (
        <section className="v1560qbr-3-css-prop-3">Content</section>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-3-css-prop-3 {
        #v1560qbr-id-1 {
            font-size: 18px;
          }
          .v1560qbr-className-2 {
            border: 2px solid navy;
          }
          &[data-id="v1560qbr-id-1"].v1560qbr-className-2 {
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
          }
      }"
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
      "export const id = "v1560qbr-id-1";
      export const className = createClassName("v1560qbr-className-2");
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
        #v1560qbr-id-1 {
              height: 60px;
            }
      }

      .v1560qbr-4-css-prop-4 {
        .v1560qbr-className-2 {
              min-height: 400px;
            }
            &.v1560qbr-className-2 {
              padding: 20px;
            }
      }"
    `);
  });
});
