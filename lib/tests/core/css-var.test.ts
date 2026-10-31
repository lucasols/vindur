import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('createCssVar', () => {
  test('should compile to the name and var reference', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createCssVar, styled } from 'vindur'

        export const iconColor = createCssVar()

        const Bar = styled.div\`
          \${iconColor.name}: red;
        \`

        const Icon = styled.svg\`
          color: \${iconColor.var};
        \`

        export const App = ({ color }) => (
          <Bar style={{ [iconColor.name]: color }}>
            <Icon />
          </Bar>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const iconColor = {
        name: "--v1560qbr-1-iconColor",
        var: "var(--v1560qbr-1-iconColor)",
      };
      export const App = ({ color }) => (
        <div
          style={{
            [iconColor.name]: color,
          }}
          className="v1560qbr-2-Bar"
        >
          <svg className="v1560qbr-3-Icon" />
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-Bar {
        --v1560qbr-1-iconColor: red;
      }

      .v1560qbr-3-Icon {
        color: var(--v1560qbr-1-iconColor);
      }
      "
    `);
  });

  test('should use short names in production', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createCssVar, css } from 'vindur'

        export const iconColor = createCssVar()

        export const icon = css\`
          color: \${iconColor.var};
        \`
      `,
      production: true,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const iconColor = {
        name: "--v1560qbr-1",
        var: "var(--v1560qbr-1)",
      };
      export const icon = "v1560qbr-2";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2 {
        color: var(--v1560qbr-1);
      }
      "
    `);
  });

  test('should resolve imported css vars', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { iconColor } from '#/vars'

        const Icon = styled.svg\`
          \${iconColor.name}: blue;
          color: \${iconColor.var};
        \`

        export const App = () => <Icon />
      `,
      overrideDefaultFs: createFsMock({
        'vars.ts': dedent`
          import { createCssVar } from 'vindur'

          export const iconColor = createCssVar()
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "export const App = () => <svg className="v1560qbr-1-Icon" />;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Icon {
        --v4j0kpc-1-iconColor: blue;
        color: var(--v4j0kpc-1-iconColor);
      }
      "
    `);
  });

  test('should pass css var properties to vindurFn functions', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createCssVar, css, vindurFn } from 'vindur'

        export const iconColor = createCssVar()

        export const colored = vindurFn((color: string) => \`color: \${color};\`)

        export const icon = css\`
          \${colored(iconColor.var)};
        \`
      `,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-icon {
        color: var(--v1560qbr-1-iconColor);
      }
      "
    `);
  });

  test('should pass theme color values to vindurFn functions', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createStaticThemeColors, css, vindurFn } from 'vindur'

        export const colors = createStaticThemeColors({ primary: '#007bff' })

        export const colored = vindurFn((color: string) => \`color: \${color};\`)

        export const icon = css\`
          \${colored(colors.primary.value)};
        \`
      `,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-icon {
        color: var(--stc-primary-var, #007bff);
      }
      "
    `);
  });

  test('should throw when a vindurFn argument property is not a primitive', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createStaticThemeColors, css, vindurFn } from 'vindur'

          export const colors = createStaticThemeColors({ primary: '#007bff' })

          export const colored = vindurFn((color: string) => \`color: \${color};\`)

          export const icon = css\`
            \${colored(colors.primary)};
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: Unresolved function call at \`... icon = css\` ... \${colored(colors.primary)}, function must be statically analyzable and correctly imported with the configured aliases
      loc: 8:4]
    `);
  });

  test('should throw when called with arguments', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createCssVar } from 'vindur'

          export const iconColor = createCssVar('iconColor')
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: createCssVar() should not be called with arguments. The variable name is automatically generated by the compiler.
      loc: 3:25]
    `);
  });

  test('should throw when used inline', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createCssVar } from 'vindur'

          export const App = () => {
            const iconColor = createCssVar()
            return <div style={{ [iconColor.name]: 'red' }} />
          }
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: createCssVar() can only be used in variable declarations at the module root level.
      loc: 4:20]
    `);
  });
});

describe('stable ID utility references', () => {
  test('should throw error when referenced without calling', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createCssVar } from 'vindur';

          const makeVar = createCssVar;
          export const color = makeVar();
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: createCssVar can only be called directly, eg. createCssVar(), other references to it are not supported
      loc: 3:16]
    `);
  });

  test('should allow typeof references in types', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createClassName } from 'vindur';

        type ClassName = ReturnType<typeof createClassName>;

        export const className: ClassName = createClassName();
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "type ClassName = ReturnType<typeof createClassName>;
      export const className: ClassName = {
        selector: ".v1560qbr-className-1",
        value: "v1560qbr-className-1",
      };
      "
    `);
  });

  test('should throw when not assigned to a const', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createCssVar } from 'vindur';

          export let iconColor = createCssVar();
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: createCssVar() must be assigned to a \`const\` variable
      loc: 3:7]
    `);
  });
});
