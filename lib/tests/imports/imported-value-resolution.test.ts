import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

const fs = createFsMock({
  'Button.tsx': dedent`
    import { styled } from 'vindur';
    import { bgColor, INSET } from '#/styles';
    import type { ButtonVariant } from '#/types';

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
    import type { Theme } from '#/types';
    import { type ButtonVariant, DEFAULT_INSET } from '#/constants';

    export const bgColor = createDynamicCssColor();

    export const INSET = DEFAULT_INSET;

    export type StylesTheme = Theme | ButtonVariant;
  `,
  'types.ts': dedent`
    import type { StylesTheme } from '#/styles';

    export type Theme = 'light' | 'dark';

    export type ButtonVariant = StylesTheme;
  `,
  'constants.ts': dedent`
    import type { StylesTheme } from '#/styles';

    export const DEFAULT_INSET = 8;

    export type ButtonVariant = StylesTheme;
  `,
});

test('should resolve imported values of a dependency whose type-only imports form a cycle', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { Button } from '#/Button';

      export const Page = () => <Button variant="light" />;
    `,
    overrideDefaultFs: fs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { Button } from "#/Button";
    export const Page = () => <Button variant="light" />;
    "
  `);
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

test('should error on imported values that are not static', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { INSET } from '#/styles';

        export const Box = styled.div\`
          top: \${INSET}px;
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          const getInset = () => 8;

          export const INSET = getInset();
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "INSET" imported from /styles.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated
    loc: 5:9]
  `);
});
