import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

test('should keep the vindurFn import of modules that declare vindur functions', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { vindurFn } from 'vindur';

      export const transition = vindurFn((property: string) => \`transition: \${property} 0.2s;\`);

      export const easings = { in: 'ease-in' };
    `,
    sourcePath: '/transition.ts',
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { vindurFn } from "vindur";
    export const transition = vindurFn(
      (property: string) => \`transition: \${property} 0.2s;\`,
    );
    export const easings = {
      in: "ease-in",
    };
    "
  `);
});

test('should only treat createDynamicCssColor and createStaticThemeColors from vindur as vindur utilities', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { legacyColor, legacyTheme } from '#/legacy';

      const Box = styled.div\`
        color: red;
      \`;

      export const A = () => <Box data-color={legacyColor} data-theme={legacyTheme} />;
    `,
    overrideDefaultFs: createFsMock({
      'legacy.ts': dedent`
        import { createDynamicCssColor, createStaticThemeColors } from '#/legacyColors';

        export const legacyColor = createDynamicCssColor('legacy-id');

        export const legacyTheme = createStaticThemeColors('legacy');
      `,
      'legacyColors.ts': dedent`
        export const createDynamicCssColor = (id: string) => id;

        export const createStaticThemeColors = (name: string) => name;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { legacyColor, legacyTheme } from "#/legacy";
    export const A = () => (
      <div
        data-color={legacyColor}
        data-theme={legacyTheme}
        className="v1560qbr-1-Box"
      />
    );
    "
  `);
});
