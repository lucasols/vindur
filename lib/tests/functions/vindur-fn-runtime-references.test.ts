import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

const transitionFs = createFsMock({
  'transition.ts': dedent`
    import { vindurFn } from 'vindur';

    export const transition = vindurFn((property: string) => \`transition: \${property} 0.2s;\`);
  `,
});

test('should allow vindurFn references in vindur styles and types', async () => {
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
    export const A = () => (
      <div className={fade + " v1560qbr-1-Box v1560qbr-3-css-prop-3"} />
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
    [TransformError: /test.tsx: vindurFn "transition" can only be used in vindur style templates (css, styled, keyframes, createGlobalStyle and css prop template literals, e.g. css={\`\${transition(...)}\`}), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime
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
    [TransformError: /test.tsx: vindurFn "transition" can only be used in vindur style templates (css, styled, keyframes, createGlobalStyle and css prop template literals, e.g. css={\`\${transition(...)}\`}), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime
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
    [TransformError: /test.tsx: vindurFn "transition" can only be used in vindur style templates (css, styled, keyframes, createGlobalStyle and css prop template literals, e.g. css={\`\${transition(...)}\`}), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime
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
    [TransformError: /test.tsx: vindurFn "transition" can only be used in vindur style templates (css, styled, keyframes, createGlobalStyle and css prop template literals, e.g. css={\`\${transition(...)}\`}), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime
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
    [TransformError: /test.tsx: vindurFn "transition" can only be used in vindur style templates (css, styled, keyframes, createGlobalStyle and css prop template literals, e.g. css={\`\${transition(...)}\`}), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime
    loc: /test.tsx|4:34]
  `);
});

test('should error on default exports of a vindurFn', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { transition } from '#/transition';

        export default (transition);
      `,
      overrideDefaultFs: transitionFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" can't be default exported, vindurFn functions can only be imported by name, use a named export
    loc: /test.tsx|3:16]
  `);
});

test('should error on aliased exports of a vindurFn', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        const transition = vindurFn((property: string) => \`transition: \${property} 0.2s;\`);

        export { transition as fade };
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" can't be exported as "fade", vindurFn functions can only be exported with their own name
    loc: /test.tsx|5:9]
  `);
});

test('should error on re-exports of an imported vindurFn', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { transition } from '#/transition';

        export { transition };
      `,
      overrideDefaultFs: transitionFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" can't be re-exported, vindurFn functions can only be imported from the module that declares them, import it directly from "#/transition"
    loc: /test.tsx|3:9]
  `);
});

test('should error on re-exports of an imported vindurFn in an import cycle', async () => {
  await expect(
    transformWithFormat({
      sourcePath: '/b.ts',
      source: dedent`
        import { f } from '#/c';

        export { f };
      `,
      overrideDefaultFs: createFsMock({
        'a.tsx': dedent`
          import { f } from '#/b';

          export const value = f(1);
        `,
        'c.ts': dedent`
          import { vindurFn } from 'vindur';
          import { value } from '#/a';

          export const usesA = value;
          export const f = vindurFn((n: number) => \`width: \${n}px;\`);
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /b.ts: vindurFn "f" can't be re-exported, vindurFn functions can only be imported from the module that declares them, import it directly from "#/c"
    loc: /b.ts|3:9]
  `);
});

test('should error on export from of a vindurFn', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        export { transition } from '#/transition';
      `,
      overrideDefaultFs: transitionFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" can't be re-exported, vindurFn functions can only be imported from the module that declares them, import it directly from "#/transition"
    loc: /test.tsx|1:9]
  `);
});

test('should error on export all of a module that declares vindurFns', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        export * from '#/transition';
      `,
      overrideDefaultFs: transitionFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" can't be re-exported, vindurFn functions can only be imported from the module that declares them, import it directly from "#/transition"
    loc: /test.tsx|1:0]
  `);
});

test('should ignore type references with the name of a vindurFn', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { transition } from '#/transition';
      import type * as transitionModule from '#/transition';

      type transition = string;

      export type Transition = transition;

      export type TransitionFn = typeof transitionModule.transition;

      export const box = css\`
        \${transition('opacity')};
      \`;
    `,
    overrideDefaultFs: transitionFs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { transition } from "#/transition";
    import type * as transitionModule from "#/transition";
    type transition = string;
    export type Transition = transition;
    export type TransitionFn = typeof transitionModule.transition;
    export const box = "v1560qbr-1-box";
    "
  `);
});

test('should error on vindurFn re-exports in imported modules', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import { transition } from '#/barrel';

        export const box = css\`
          \${transition('opacity')};
        \`;
      `,
      overrideDefaultFs: createFsMock({
        'transition.ts': dedent`
          import { vindurFn } from 'vindur';

          export const transition = vindurFn((property: string) => \`transition: \${property} 0.2s;\`);
        `,
        'barrel.ts': dedent`
          import { transition } from '#/transition';

          export { transition };
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: /barrel.ts: vindurFn "transition" can't be re-exported, vindurFn functions can only be imported from the module that declares them, import it directly from "#/transition"
    loc: /barrel.ts|3:9]
  `);
});

test('should error when a vindurFn is used as a styled component', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { transition } from '#/transition';

        export const Box = styled(transition)\`
          color: red;
        \`;
      `,
      overrideDefaultFs: transitionFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" can only be used in vindur style templates (css, styled, keyframes, createGlobalStyle and css prop template literals, e.g. css={\`\${transition(...)}\`}), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime
    loc: /test.tsx|4:26]
  `);
});

test('should report the vindurFn validation error for vindurFn compositions', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';
        import { transition } from '#/transition';

        export const fade = vindurFn((property: string) => \`\${transition(property)} opacity: 0;\`);
      `,
      overrideDefaultFs: transitionFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "fade" contains function calls which are not supported - functions must be self-contained
    loc: /test.tsx|4:54]
  `);
});

test('should error on namespace imports of modules that export vindurFns', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';
        import * as mixins from '#/transition';

        export const box = css\`
          color: red;
        \`;

        export const value = mixins.transition('opacity');
      `,
      overrideDefaultFs: transitionFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn exports of "#/transition" can't be imported with a namespace import, import them by name, e.g. import { transition } from "#/transition"
    loc: 2:7]
  `);
});

test('should error on vindurFn declarations that are not exported constants', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export default vindurFn((size: number) => \`padding: \${size}px;\`);
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn is not supported here, vindur functions must be declared with "export const name = vindurFn((...) => ...)"
    loc: 3:15]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const mixins = {
          spacing: vindurFn((size: number) => \`padding: \${size}px;\`),
        };
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn is not supported here, vindur functions must be declared with "export const name = vindurFn((...) => ...)"
    loc: 4:11]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export function createSpacing() {
          const spacing = vindurFn((size: number) => \`padding: \${size}px;\`);
          return spacing;
        }
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn is not supported here, vindur functions must be declared with "export const name = vindurFn((...) => ...)"
    loc: 4:18]
  `);
});

test('should allow vindurFn usage in templates of the global styled', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { transition } from '#/transition';

      const Box = styled.div\`
        \${transition('opacity')};
      \`;

      export const App = () => <Box />;
    `,
    overrideDefaultFs: transitionFs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = () => <div className="v1560qbr-1-Box" />;
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      transition: opacity 0.2s;
    }
    "
  `);
});

test('should error on indirect references to vindurFn', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const spacing = (vindurFn)((size: number) => \`padding: \${size}px;\`);
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn is not supported here, vindur functions must be declared with "export const name = vindurFn((...) => ...)"
    loc: 3:24]
  `);
});

test('should error on destructured vindurFn declarations', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        export const { length } = vindurFn((size: number) => \`padding: \${size}px;\`);
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn is not supported here, vindur functions must be declared with "export const name = vindurFn((...) => ...)"
    loc: 3:26]
  `);
});

test('should error on vindurFn usage in templates of tags that are not imported', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { transition } from '#/transition';

        export const box = css\`
          \${transition('opacity')};
        \`;
      `,
      overrideDefaultFs: transitionFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" can only be used in vindur style templates (css, styled, keyframes, createGlobalStyle and css prop template literals, e.g. css={\`\${transition(...)}\`}), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime
    loc: /test.tsx|4:4]
  `);
});

test('should error on vindurFn sharing a variable declaration', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { vindurFn } from 'vindur';

        const size = 2, spacing = vindurFn((value: number) => \`padding: \${value}px;\`);

        export { size };
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn functions must use their own variable declaration
    loc: 3:0]
  `);
});

test('should error on vindurFn usage in templates of runtime vindur imports', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { cx } from 'vindur';
        import { transition } from '#/transition';

        export const className = cx\`\${transition('opacity')}\`;
      `,
      overrideDefaultFs: transitionFs,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: vindurFn "transition" can only be used in vindur style templates (css, styled, keyframes, createGlobalStyle and css prop template literals, e.g. css={\`\${transition(...)}\`}), vindurFn functions are evaluated at compile time and cannot be called or referenced at runtime
    loc: /test.tsx|4:30]
  `);
});
