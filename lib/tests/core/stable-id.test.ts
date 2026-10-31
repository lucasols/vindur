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
      "export const myId = "v1560qbr-1-myId";
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
      "export const firstId = "v1560qbr-1-firstId";
      export const secondId = "v1560qbr-2-secondId";
      export const thirdId = "v1560qbr-3-thirdId";
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
      "export const myId = "v1560qbr-1-myId";
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
      "export const myClassName = {
        selector: ".v1560qbr-1-myClassName",
        value: "v1560qbr-1-myClassName",
      };
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
      "export const firstClassName = {
        selector: ".v1560qbr-1-firstClassName",
        value: "v1560qbr-1-firstClassName",
      };
      export const secondClassName = {
        selector: ".v1560qbr-2-secondClassName",
        value: "v1560qbr-2-secondClassName",
      };
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
      "export const myClassName = {
        selector: ".v1560qbr-1-myClassName",
        value: "v1560qbr-1-myClassName",
      };
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
      `
      [TransformError: /test.tsx: createClassName() cannot be used with destructuring assignment. Use a regular variable assignment instead.
      loc: 3:35]
    `,
    );
  });

  test('should throw error for let declarations', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { stableId } from 'vindur';

          export let id = stableId();
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: Vindur declarations must use \`const\`, not \`let\`, they are evaluated at compile time
      loc: 3:7]
    `);

    await expect(
      transformWithFormat({
        source: dedent`
          import { createClassName } from 'vindur';

          export let className = createClassName();
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: Vindur declarations must use \`const\`, not \`let\`, they are evaluated at compile time
      loc: 3:7]
    `);
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
      `
      [TransformError: /test.tsx: createClassName() can only be used in variable declarations at the module root level.
      loc: 4:20]
    `,
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
      `
      [TransformError: /test.tsx: createClassName() can only be used in variable declarations at the module root level, not inline.
      loc: 3:35]
    `,
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
      `
      [TransformError: /test.tsx: createClassName() can only be used in variable declarations at the module root level, not inline.
      loc: 4:13]
    `,
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
      `
      [TransformError: /test.tsx: createClassName() can only be used in variable declarations at the module root level, not inline.
      loc: 3:27]
    `,
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
      "export const id = "v1560qbr-1-id";
      export const className = {
        selector: ".v1560qbr-2-className",
        value: "v1560qbr-2-className",
      };
      export const anotherId = "v1560qbr-3-anotherId";
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
      export const id = "v1560qbr-2-id";
      export const className = {
        selector: ".v1560qbr-3-className",
        value: "v1560qbr-3-className",
      };
      export const style2 = "v1560qbr-4-style2";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-style1 {
        color: red;
      }

      .v1560qbr-4-style2 {
        color: blue;
      }
      "
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
      "export const id = "v1560qbr-1-id";
      export const style = "v1560qbr-2-style";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-style {
        #v1560qbr-1-id {
          color: red;
        }
      }
      "
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
      "export const className = {
        selector: ".v1560qbr-1-className",
        value: "v1560qbr-1-className",
      };
      export const style = "v1560qbr-2-style";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-style {
        .v1560qbr-1-className {
          background: blue;
        }
        .v1560qbr-1-className {
          border: 1px solid black;
        }
      }
      "
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
      "export const id = "v1560qbr-1-id";
      export const className = {
        selector: ".v1560qbr-2-className",
        value: "v1560qbr-2-className",
      };
      export const style = "v1560qbr-3-style";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-3-style {
        #v1560qbr-1-id {
          color: red;
        }
        .v1560qbr-2-className {
          background: blue;
        }
      }
      "
    `);
  });
});

test('should throw for stableId() in a style flag value', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled, stableId } from 'vindur';

        const Box = styled.div<{ active: boolean }>\`
          &.active { color: red; }
        \`;

        export const App = ({ selectedId }: { selectedId: string }) => (
          <Box active={selectedId === stableId()} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag \`active\` value can't call \`stableId()\` or \`createClassName()\`, as the value is moved into the className, assign the result to a module level constant first
    loc: 8:30]
  `);
});
