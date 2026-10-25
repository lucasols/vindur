import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

const transitionFs = createFsMock({
  'transition.ts': dedent`
    import { vindurFn } from 'vindur';

    export const transition = vindurFn((property: string) => \`transition: \${property} 0.2s;\`);
  `,
});

test('should allow vindurFn references in vindur styles, re-exports and types', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, styled } from 'vindur';
      import { transition } from '#/transition';

      type Transition = typeof transition;

      const Box = styled.div\`
        \${transition('opacity')};
      \`;

      const fade = css\`
        \${transition('color')};
      \`;

      export { transition };

      export const A = () => (
        <Box className={fade} css={\`\${transition('width')};\`} />
      );
    `,
    overrideDefaultFs: transitionFs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { transition } from "#/transition";
    type Transition = typeof transition;
    const fade = "v1560qbr-2-fade";
    export { transition };
    export const A = () => (
      <div
        className={[fade, "v1560qbr-1-Box v1560qbr-3-css-prop-3"]
          .filter(Boolean)
          .join(" ")}
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      transition: opacity 0.2s;
    }

    .v1560qbr-2-fade {
      transition: color 0.2s;
    }

    .v1560qbr-3-css-prop-3 {
      transition: width 0.2s;
    }
    "
  `);
});

test('should not flag local bindings that shadow a vindurFn', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { transition } from '#/transition';

      const fade = css\`
        \${transition('opacity')};
      \`;

      export const getTransition = (transition: string) => transition;
    `,
    overrideDefaultFs: transitionFs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const fade = "v1560qbr-1-fade";
    export const getTransition = (transition: string) => transition;
    "
  `);
});

test('should error when an imported vindurFn is called at runtime', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { transition } from '#/transition';

        export const A = () => <div style={{ transition: transition('opacity') }} />;
      `,
      overrideDefaultFs: transitionFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" can only be used in vindur styles (css, styled, keyframes, createGlobalStyle and the css prop), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime
    loc: /test.tsx|3:49]
  `);
});

test('should error when a vindurFn is passed around as a value', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { transition } from '#/transition';

        export const helpers = [transition];
      `,
      overrideDefaultFs: transitionFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" can only be used in vindur styles (css, styled, keyframes, createGlobalStyle and the css prop), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime
    loc: /test.tsx|3:24]
  `);
});

test('should error when a vindurFn is used in attrs', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { transition } from '#/transition';

        export const Box = styled.div.attrs({ 'data-transition': transition('opacity') })\`
          color: red;
        \`;
      `,
      overrideDefaultFs: transitionFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" can only be used in vindur styles (css, styled, keyframes, createGlobalStyle and the css prop), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime
    loc: /test.tsx|4:57]
  `);
});

test('should error when a vindurFn is called at runtime in the module that declares it', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const transition = vindurFn((property: string) => \`transition: \${property} 0.2s;\`);

        export const fadeTransition = transition('opacity');
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" can only be used in vindur styles (css, styled, keyframes, createGlobalStyle and the css prop), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime
    loc: /test.tsx|5:30]
  `);
});

test('should error when a vindurFn is passed through the css prop of a custom component', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { transition } from '#/transition';
        import { Card } from '#/card';

        export const A = () => <Card css={transition('opacity')} />;
      `,
      overrideDefaultFs: transitionFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" can only be used in vindur styles (css, styled, keyframes, createGlobalStyle and the css prop), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime
    loc: /test.tsx|4:34]
  `);
});
