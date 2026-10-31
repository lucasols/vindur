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

test('should error on aliased vindur imports', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, createDynamicCssColor as dynamicColor } from 'vindur';

        const bg = dynamicColor();

        export const box = css\`
          background: \${bg.value};
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: aliased vindur imports are not supported, import "createDynamicCssColor" without the "dynamicColor" alias
    loc: 1:14]
  `);
});

test('should error on aliased vindur imports in imported modules', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import { transition } from '#/transition';

        export const box = css\`
          \${transition('opacity')};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'transition.ts': dedent`
          import { vindurFn as fn } from 'vindur';

          export const transition = fn((property: string) => \`transition: \${property} 0.2s;\`);
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: /transition.ts: aliased vindur imports are not supported, import "vindurFn" without the "fn" alias
    loc: /transition.ts|1:9]
  `);
});

test('should only treat vindurFn from vindur as a vindur function', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { helper } from '#/helpers';

      export const label = helper('a');
    `,
    overrideDefaultFs: createFsMock({
      'helpers.ts': dedent`
        import { vindurFn } from '#/legacy';

        export const helper = vindurFn((value: string) => value);
      `,
      'legacy.ts': dedent`
        export const vindurFn = <T,>(fn: T) => fn;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { helper } from "#/helpers";
    export const label = helper("a");
    "
  `);
});

test('should allow aliased vindur type imports', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, type StyledComponent as Styled } from 'vindur';

      export const box = css\`
        color: red;
      \`;

      export type Box = Styled;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { type StyledComponent as Styled } from "vindur";
    export const box = "v1560qbr-1-box";
    export type Box = Styled;
    "
  `);
});

test('should keep type only vindur imports when merging vindur imports', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import type { StyledComponent } from 'vindur';
      import { styled } from 'vindur';

      export const Box: StyledComponent<'div'> = styled.div\`
        color: red;
      \`;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vSC } from "vindur";
    import type { StyledComponent } from "vindur";
    export const Box: StyledComponent<"div"> = _vSC("div", "v1560qbr-1-Box");
    "
  `);
});

test('should error on namespace imports from vindur', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import * as vindur from 'vindur';

        export const box = css\`
          color: red;
        \`;

        export const className = vindur.cx({ active: true });
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: namespace vindur imports are not supported, import the names you use, eg. import { styled } from "vindur"
    loc: 2:7]
  `);
});

test('should error on default imports from vindur', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import vindur from 'vindur';

        export const box = vindur.css\`
          color: red;
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: default vindur imports are not supported, import the names you use, eg. import { styled } from "vindur"
    loc: 1:7]
  `);
});

test('should alias the cx helper when cx is only imported as a type', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import type { cx } from 'vindur';

      export type Cx = typeof cx;

      export const Component = ({ active }: { active: boolean }) => (
        <div cx={{ $active: active }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx as _vCx } from "vindur";
    import type { cx } from "vindur";
    export type Cx = typeof cx;
    export const Component = ({ active }: { active: boolean }) => (
      <div
        className={_vCx({
          active: active,
        })}
      />
    );
    "
  `);
});

test('should keep type-only vindur imports as type imports', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import type { styled, StyledComponent } from 'vindur';
      import { css } from 'vindur';

      export type Box = StyledComponent<'div'>;
      export type Styled = typeof styled;

      export const box = css\`
        color: red;
      \`;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import type { StyledComponent } from "vindur";
    export type Box = StyledComponent<"div">;
    export type Styled = typeof styled;
    export const box = "v1560qbr-1-box";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-box {
      color: red;
    }
    "
  `);
});
