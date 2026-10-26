import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

const createCycleFs = (typeModifier: 'type ' | '') => createFsMock({
  'Button.tsx': dedent`
    import { styled } from 'vindur';
    import { bgColor, INSET } from '#/styles';
    import ${typeModifier}{ ButtonVariant } from '#/types';

    export const BUTTON_INSET = INSET;

    const Container = styled.button\`
      top: \${INSET}px;

      \${bgColor.container.isDark} & {
        color: white;
      }
    \`;

    export const Button = ({ variant }: { variant: ButtonVariant }) => (
      <Container data-variant={variant} />
    );
  `,
  'styles.ts': dedent`
    import { createDynamicCssColor } from 'vindur';
    import ${typeModifier}{ Theme } from '#/types';
    import { ${typeModifier}ButtonVariant, DEFAULT_INSET } from '#/constants';

    export const bgColor = createDynamicCssColor();

    export const INSET = DEFAULT_INSET;

    export type StylesTheme = Theme | ButtonVariant;
  `,
  'types.ts': dedent`
    import ${typeModifier}{ StylesTheme } from '#/styles';

    export type Theme = 'light' | 'dark';

    export type ButtonVariant = StylesTheme;
  `,
  'constants.ts': dedent`
    import ${typeModifier}{ StylesTheme } from '#/styles';

    export const DEFAULT_INSET = 8;

    export type ButtonVariant = StylesTheme;
  `,
});

const fs = createCycleFs('type ');

const transformCyclePage = (typeModifier: 'type ' | '') =>
  transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { Button, BUTTON_INSET } from '#/Button';

      const Wrapper = styled.div\`
        padding: \${BUTTON_INSET}px;
      \`;

      export const Page = () => (
        <Wrapper>
          <Button variant="light" />
        </Wrapper>
      );
    `,
    overrideDefaultFs: createCycleFs(typeModifier),
  });

test('should resolve imported values of a dependency whose type-only imports form a cycle', async () => {
  const result = await transformCyclePage('type ');

  expect(result.code).toMatchInlineSnapshot(`
    "import { Button } from "#/Button";
    export const Page = () => (
      <div className="v1560qbr-1-Wrapper">
        <Button variant="light" />
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Wrapper {
      padding: 8px;
    }
    "
  `);
});

test('should treat imports only used as types as type-only imports', async () => {
  expect(await transformCyclePage('')).toEqual(
    await transformCyclePage('type '),
  );
});

test('should compile the dependency itself', async () => {
  const result = await transformWithFormat({
    source: fs.readFile('/Button.tsx'),
    sourcePath: '/Button.tsx',
    overrideDefaultFs: fs,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v13zbx73-1-Container {
      top: 8px;

      .v1s4vg6s-1-c0 & {
        color: white;
      }
    }
    "
  `);
});

test('should resolve constants that re-export imported values', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { INSET, DOUBLE_INSET } from '#/mid';

      export const Box = styled.div\`
        top: \${INSET}px;
        left: \${DOUBLE_INSET}px;
      \`;
    `,
    overrideDefaultFs: createFsMock({
      'constants.ts': dedent`
        export const DEFAULT_INSET = 8;
      `,
      'styles.ts': dedent`
        import { DEFAULT_INSET } from '#/constants';

        export const INSET = DEFAULT_INSET;

        export const DOUBLE_INSET = DEFAULT_INSET * 2;
      `,
      'mid.ts': dedent`
        import { INSET as STYLES_INSET, DOUBLE_INSET } from '#/styles';

        export const INSET = STYLES_INSET;

        export { DOUBLE_INSET };
      `,
    }),
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      top: 8px;
      left: 16px;
    }
    "
  `);
});

test('should resolve values exported with an alias', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { INSET } from '#/styles';

      export const style = css\`
        top: \${INSET}px;
      \`;
    `,
    overrideDefaultFs: createFsMock({
      'styles.ts': dedent`
        const inset = 8;

        export { inset as INSET };
      `,
    }),
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      top: 8px;
    }
    "
  `);
});

test('should keep imports moved into generated code', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { INSET, color } from '#/styles';

      const Box = styled.div\`
        top: \${INSET}px;
      \`;

      export const Page = () => (
        <Box dynamicColor={color.set('red')} style={{ padding: INSET }} />
      );
    `,
    overrideDefaultFs: createFsMock({
      'styles.ts': dedent`
        import { createDynamicCssColor } from 'vindur';

        export const INSET = 8;

        export const color = createDynamicCssColor();
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { INSET, color } from "#/styles";
    export const Page = () => (
      <div
        {...color._sp("red", {
          className: "v1560qbr-1-Box",
          style: {
            padding: INSET,
          },
        })}
      />
    );
    "
  `);
});
