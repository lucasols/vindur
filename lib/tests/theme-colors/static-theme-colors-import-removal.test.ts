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

test.each([
  ['a bare import', `import './reset.css';`],
  ['a top-level call', `registerTheme();`],
  ['a re-export', `export { FONT } from './fonts';`],
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
