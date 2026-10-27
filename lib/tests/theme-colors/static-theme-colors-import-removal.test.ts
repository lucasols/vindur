import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

const fs = createFsMock({
  'colors.ts': dedent`
    import { createStaticThemeColors } from 'vindur';

    export const colors = createStaticThemeColors({ primary: '#007bff' });

    export const helper = () => 1;
  `,
});

test('should remove imported theme colors only used in templates', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled, css, createGlobalStyle } from 'vindur';
      import { colors } from '#/colors';

      createGlobalStyle\`
        body {
          color: \${colors.primary.var};
        }
      \`;

      const Box = styled.div\`
        color: \${colors.primary.var};
      \`;

      export const A = () => (
        <>
          <Box />
          <div className={css\`border-color: \${colors.primary.darker(0.1)};\`} />
          <div css={\`outline-color: \${colors.primary.var};\`} />
        </>
      );
    `,
    overrideDefaultFs: fs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = () => (
      <>
        <div className="v1560qbr-2-Box" />
        <div className={"v1560qbr-4"} />
        <div className="v1560qbr-3-css-prop-3" />
      </>
    );
    "
  `);
});

test('should keep the other specifiers of a removed theme colors import', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { colors, helper } from '#/colors';

      export const styles = css\`
        color: \${colors.primary.var};
      \`;

      export const value = helper();
    `,
    overrideDefaultFs: fs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { helper } from "#/colors";
    export const styles = "v1560qbr-1-styles";
    export const value = helper();
    "
  `);
});

test('should keep imported theme colors used at runtime', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { colors } from '#/colors';

      export const Box = styled.div.attrs({ title: colors.primary.var })\`
        color: \${colors.primary.var};
      \`;

      export const A = () => <div style={{ color: colors.primary.var }} />;
    `,
    overrideDefaultFs: fs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vSC } from "vindur";
    import { colors } from "#/colors";
    export const Box = _vSC("div", "v1560qbr-1-Box", {
      title: colors.primary.var,
    });
    export const A = () => (
      <div
        style={{
          color: colors.primary.var,
        }}
      />
    );
    "
  `);
});

test('should keep a side effect import of a colors module with global styles', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { colors } from '#/theme';

      export const styles = css\`
        color: \${colors.primary.var};
      \`;
    `,
    overrideDefaultFs: createFsMock({
      'theme.ts': dedent`
        import { createStaticThemeColors, createGlobalStyle } from 'vindur';

        export const colors = createStaticThemeColors({ primary: '#007bff' });

        createGlobalStyle\`
          body {
            background: \${colors.primary.var};
          }
        \`;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import "#/theme";
    export const styles = "v1560qbr-1-styles";
    "
  `);
});

test('should keep a side effect import of a colors module importing global styles', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { colors } from '#/theme';

      export const styles = css\`
        color: \${colors.primary.var};
      \`;
    `,
    overrideDefaultFs: createFsMock({
      'theme.ts': dedent`
        import { createStaticThemeColors } from 'vindur';
        import { FONT } from './fonts';

        export const colors = createStaticThemeColors({ primary: '#007bff' });

        export const font = FONT;
      `,
      'fonts.ts': dedent`
        import { createGlobalStyle } from 'vindur';

        export const FONT = 'Inter';

        createGlobalStyle\`
          body {
            font-family: \${FONT};
          }
        \`;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import "#/theme";
    export const styles = "v1560qbr-1-styles";
    "
  `);
});

test('should remove a colors module without side effects and depend on its imports', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { colors } from '#/theme';

      export const styles = css\`
        color: \${colors.primary.var};
      \`;
    `,
    overrideDefaultFs: createFsMock({
      'theme.ts': dedent`
        import { createStaticThemeColors, styled } from 'vindur';
        import { BRAND } from './palette';
        import { formatColor } from './format';

        type Theme = { dark: boolean };

        const RADIUS = 20;

        export const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

        export const colors = createStaticThemeColors({ primary: '#007bff' });

        export const Swatch = styled.div\`
          color: \${colors.primary.var};
        \`;

        export function getTheme(dark: boolean): Theme {
          return { dark };
        }

        export const format = () => formatColor(BRAND);
      `,
      'palette.ts': `export const BRAND = '#007bff';`,
      'format.ts': `export const formatColor = (color: string) => color;`,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const styles = "v1560qbr-1-styles";
    "
  `);
  expect(result.styleDependencies).toEqual([
    '/theme.ts',
    '/palette.ts',
    '/format.ts',
  ]);
});

test.each([
  ['a bare import', `import './reset.css';`],
  ['a top-level call', `registerTheme();`],
  ['a re-export', `export { FONT } from './fonts';`],
  ['a call in a declaration', `export const ready = registerTheme();`],
  ['a call in a default export', `export default registerTheme();`],
  ['a class', `class Registry { static { registerTheme(); } }`],
  [
    'a package import',
    `import { registry } from 'theme-registry'; export const r = registry;`,
  ],
  [
    'a CSS module import',
    `import cls from './theme.module.css'; export const c = cls;`,
  ],
  [
    'a runtime helper call',
    `import { cx } from 'vindur'; const flags = { get a() { return registerTheme(); } }; export const c = cx(flags);`,
  ],
  [
    'an interpolated value',
    'const token = { toString: () => registerTheme() }; export const label = `${token}`;',
  ],
  [
    'a getter in styled attrs',
    "import { styled } from 'vindur'; export const B = styled.div.attrs({ get title() { return registerTheme(); } })`color: red;`;",
  ],
  [
    'a computed key',
    'const token = { toString: () => registerTheme() }; export const map = { [token]: 1 };',
  ],
  [
    'a method call on a vindur function',
    'export const r = createStaticThemeColors.call.call(() => registerTheme(), undefined);',
  ],
])(
  'should keep a side effect import of a colors module with %s',
  async (_, statement) => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import { colors } from '#/theme';

        export const styles = css\`
          color: \${colors.primary.var};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'theme.ts': dedent`
          import { createStaticThemeColors } from 'vindur';

          export const colors = createStaticThemeColors({ primary: '#007bff' });

          ${statement}
        `,
        'fonts.ts': `export const FONT = 'Inter';`,
      }),
    });

    expect(result.code).toBe(
      'import "#/theme";\nexport const styles = "v1560qbr-1-styles";\n',
    );
  },
);

test('should keep a side effect import next to type-only specifiers of a module with side effects', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { colors, type Theme, Mode } from '#/theme';

      export const styles = css\`
        color: \${colors.primary.var};
      \`;

      export const getMode = (theme: Theme): Mode => theme.mode;
    `,
    overrideDefaultFs: createFsMock({
      'theme.ts': dedent`
        import { createStaticThemeColors, createGlobalStyle } from 'vindur';

        export type Mode = 'light' | 'dark';

        export type Theme = { mode: Mode };

        export const colors = createStaticThemeColors({ primary: '#007bff' });

        createGlobalStyle\`
          body {
            background: \${colors.primary.var};
          }
        \`;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import "#/theme";
    import { type Theme, Mode } from "#/theme";
    export const styles = "v1560qbr-1-styles";
    export const getMode = (theme: Theme): Mode => theme.mode;
    "
  `);
});

test('should keep a side effect import when only type references of the colors remain', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { colors } from '#/theme';

      export const styles = css\`
        color: \${colors.primary.var};
      \`;

      export type Palette = typeof colors;
    `,
    overrideDefaultFs: createFsMock({
      'theme.ts': dedent`
        import { createStaticThemeColors, createGlobalStyle } from 'vindur';

        export const colors = createStaticThemeColors({ primary: '#007bff' });

        createGlobalStyle\`
          body {
            margin: 0;
          }
        \`;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import "#/theme";
    import { colors } from "#/theme";
    export const styles = "v1560qbr-1-styles";
    export type Palette = typeof colors;
    "
  `);
});

test('should not add a side effect import for a styled component only used in selectors', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { Button } from '#/theme';

      export const Box = styled.div\`
        \${Button}:hover & {
          color: red;
        }
      \`;
    `,
    overrideDefaultFs: createFsMock({
      'theme.ts': dedent`
        import { styled, createGlobalStyle } from 'vindur';

        export const Button = styled.button\`
          color: blue;
        \`;

        createGlobalStyle\`
          body {
            margin: 0;
          }
        \`;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vSC } from "vindur";
    import { Button } from "#/theme";
    export const Box = _vSC("div", "v1560qbr-1-Box");
    "
  `);
});

test('should remove an import of a constant from a module with side effects', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { BRAND } from '#/consts';

      export const styles = css\`
        color: \${BRAND};
      \`;
    `,
    overrideDefaultFs: createFsMock({
      'consts.ts': dedent`
        import clsx from 'clsx';

        export const BRAND = '#007bff';

        export const join = (a: string, b: string) => clsx(a, b);
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const styles = "v1560qbr-1-styles";
    "
  `);
});

test('should not add a side effect import for an unused import of a module with side effects', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { helper } from '#/lib';

      export const styles = css\`
        color: red;
      \`;
    `,
    overrideDefaultFs: createFsMock({
      'lib.ts': dedent`
        registerHelpers();

        export const helper = () => 1;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { helper } from "#/lib";
    export const styles = "v1560qbr-1-styles";
    "
  `);
});

test('should not depend on the runtime imports of a module without side effects', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { formatColor } from '#/format';

      export const styles = css\`
        color: red;
      \`;

      export const color = formatColor('red');
    `,
    overrideDefaultFs: createFsMock({
      'format.ts': dedent`
        import { BRAND } from './palette';

        export const formatColor = (color: string) => color || BRAND;
      `,
      'palette.ts': `export const BRAND = '#007bff';`,
    }),
  });

  expect(result.styleDependencies).toEqual([]);
});
