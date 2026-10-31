import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { invalidateTransformCache, transform } from '../../src/transform';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('keyframes cross-file imports', () => {
  test('should handle keyframes imported from another file', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { fadeIn } from '#/animations'
        import { css } from 'vindur'

        const animatedStyle = css\`
          animation: \${fadeIn} 0.3s ease-in-out;
          background: white;
        \`
      `,

      overrideDefaultFs: createFsMock({
        'animations.ts': dedent`
          import { keyframes } from 'vindur'

          export const fadeIn = keyframes\`
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import "#/animations";
      const animatedStyle = "v1560qbr-1-animatedStyle";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-animatedStyle {
        animation: v1gz5uqy-1-fadeIn 0.3s ease-in-out;
        background: white;
      }
      "
    `);

    expect(result.styleDependencies).toMatchInlineSnapshot(`
      [
        "/animations.ts",
      ]
    `);
  });

  test('should handle multiple imported keyframes', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { fadeIn, slideUp } from '#/animations'
        import { styled } from 'vindur'

        const Card = styled.div\`
          animation: \${fadeIn} 0.3s ease-in-out;
  
          &:hover {
            animation: \${slideUp} 0.2s ease-out;
          }
        \`
      `,

      overrideDefaultFs: createFsMock({
        'animations.ts': dedent`
          import { keyframes } from 'vindur'

          export const fadeIn = keyframes\`
            from { opacity: 0; }
            to { opacity: 1; }
          \`

          export const slideUp = keyframes\`
            from { transform: translateY(10px); }
            to { transform: translateY(0); }
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import "#/animations";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        animation: v1gz5uqy-1-fadeIn 0.3s ease-in-out;

        &:hover {
          animation: v1gz5uqy-2-slideUp 0.2s ease-out;
        }
      }
      "
    `);
  });

  test('should handle keyframes in css function', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { bounceIn } from '#/animations'
        import { css } from 'vindur'

        const animatedStyle = css\`
          animation: \${bounceIn} 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
          background: #f0f0f0;
        \`
      `,
      overrideDefaultFs: createFsMock({
        'animations.ts': dedent`
          import { keyframes } from 'vindur'

          export const bounceIn = keyframes\`
            0% {
              transform: scale(0.3);
              opacity: 0;
            }
            50% {
              transform: scale(1.05);
            }
            70% {
              transform: scale(0.9);
            }
            100% {
              transform: scale(1);
              opacity: 1;
            }
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import "#/animations";
      const animatedStyle = "v1560qbr-1-animatedStyle";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-animatedStyle {
        animation: v1gz5uqy-1-bounceIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        background: #f0f0f0;
      }
      "
    `);
  });

  test('should handle keyframes with variable interpolation in external file', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { customSlide } from '#/animations'
        import { styled } from 'vindur'

        const Slider = styled.div\`
          animation: \${customSlide} 1s ease-in-out;
        \`
      `,
      overrideDefaultFs: createFsMock({
        'animations.ts': dedent`
          import { keyframes } from 'vindur'

          const distance = '200px'

          export const customSlide = keyframes\`
            from {
              transform: translateX(-\${distance});
            }
            to {
              transform: translateX(0);
            }
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import "#/animations";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Slider {
        animation: v1gz5uqy-1-customSlide 1s ease-in-out;
      }
      "
    `);
  });

  test('should handle local and imported keyframes together', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { fadeIn } from '#/animations'
        import { keyframes, styled } from 'vindur'

        const localBounce = keyframes\`
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        \`

        const Component = styled.div\`
          animation: \${fadeIn} 0.3s ease-in, \${localBounce} 0.6s ease-in-out infinite;
        \`
      `,
      overrideDefaultFs: createFsMock({
        'animations.ts': dedent`
          import { keyframes } from 'vindur'

          export const fadeIn = keyframes\`
            from { opacity: 0; }
            to { opacity: 1; }
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import "#/animations";
      const localBounce = "v1560qbr-1-localBounce";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1560qbr-1-localBounce {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-10px);
        }
      }

      .v1560qbr-2-Component {
        animation:
          v1gz5uqy-1-fadeIn 0.3s ease-in,
          v1560qbr-1-localBounce 0.6s ease-in-out infinite;
      }
      "
    `);
  });

  test('should keep the module of an inlined css mixin that uses keyframes', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { fadeMixin } from '#/mixins'

        export const Card = styled.div\`
          \${fadeMixin};
          color: red;
        \`
      `,

      overrideDefaultFs: createFsMock({
        'mixins.ts': dedent`
          import { css, keyframes } from 'vindur'

          const fade = keyframes\`
            from { opacity: 0; }
            to { opacity: 1; }
          \`

          export const fadeMixin = css\`
            animation: \${fade} 1s;
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      import "#/mixins";
      export const Card = _vSC("div", "v1560qbr-1-Card");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        animation: v1pkdo29-1-fade 1s;
        color: red;
      }
      "
    `);
  });

  test('should keep the module of a chained css mixin that uses keyframes', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { cardMixin } from '#/card'

        export const Card = styled.div\`
          \${cardMixin};
          color: red;
        \`
      `,

      overrideDefaultFs: createFsMock({
        'card.ts': dedent`
          import { css } from 'vindur'
          import { fadeMixin } from './mixins'

          export const cardMixin = css\`
            \${fadeMixin};
            padding: 8px;
          \`
        `,
        'mixins.ts': dedent`
          import { css } from 'vindur'
          import { fade } from './animations'

          export const fadeMixin = css\`
            animation: \${fade} 1s;
          \`
        `,
        'animations.ts': dedent`
          import { keyframes } from 'vindur'

          export const fade = keyframes\`
            from { opacity: 0; }
            to { opacity: 1; }
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      import "#/card";
      export const Card = _vSC("div", "v1560qbr-1-Card");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        animation: v1gz5uqy-1-fade 1s;
        padding: 8px;
        color: red;
      }
      "
    `);
  });

  test('should keep the module of a css mixin passing keyframes to a vindurFn', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { fadeMixin } from '#/mixins'

        export const Card = styled.div\`
          \${fadeMixin};
          color: red;
        \`
      `,

      overrideDefaultFs: createFsMock({
        'animate.ts': dedent`
          import { vindurFn } from 'vindur'

          export const animate = vindurFn((name: string) => \`animation: \${name} 1s;\`)
        `,
        'mixins.ts': dedent`
          import { css, keyframes } from 'vindur'
          import { animate } from '#/animate'

          const fade = keyframes\`
            from { opacity: 0; }
            to { opacity: 1; }
          \`

          export const fadeMixin = css\`
            \${animate(fade)};
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      import "#/mixins";
      export const Card = _vSC("div", "v1560qbr-1-Card");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        animation: v1pkdo29-1-fade 1s;
        color: red;
      }
      "
    `);
  });

  test('should throw error when imported keyframes is not found', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { unknownAnimation } from '#/animations'
          import { styled } from 'vindur'

          const Component = styled.div\`
            animation: \${unknownAnimation} 1s ease;
          \`
        `,
        overrideDefaultFs: createFsMock({
          'animations.ts': dedent`
            import { keyframes } from 'vindur'

            export const fadeIn = keyframes\`
              from { opacity: 0; }
              to { opacity: 1; }
            \`
          `,
        }),
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: "unknownAnimation" not found in /animations.ts, export it by name, like \`export const unknownAnimation = ...\` or \`export { unknownAnimation }\`
      loc: 5:15]
    `,
    );
  });

  test('should error on imported constants built from keyframes', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { animation } from '#/derived'
          import { styled } from 'vindur'

          const Component = styled.div\`
            animation: \${animation};
          \`
        `,
        overrideDefaultFs: createFsMock({
          'animations.ts': dedent`
            import { keyframes } from 'vindur'

            export const fadeIn = keyframes\`
              from { opacity: 0; }
              to { opacity: 1; }
            \`
          `,
          'derived.ts': dedent`
            import { fadeIn } from '#/animations'

            export const animation = \`\${fadeIn} 1s ease\`
          `,
        }),
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: "animation" imported from /derived.ts is not a static value, only strings, numbers and other statically analyzable values can be interpolated
      loc: 5:15]
    `,
    );
  });

  test('should recompile when the keyframes source file changes', () => {
    const files = {
      '/animations.ts': dedent`
        import { keyframes } from 'vindur'

        export const fadeIn = keyframes\`
          from { opacity: 0; }
          to { opacity: 1; }
        \`
      `,
    };
    const transformFunctionCache = {};
    const transformComponent = () =>
      transform({
        fileAbsPath: '/Component.tsx',
        source: dedent`
          import { fadeIn } from '#/animations'
          import { css } from 'vindur'

          const style = css\`
            animation: \${fadeIn} 1s;
          \`
        `,
        fs: {
          readFile: (filePath) => {
            if (filePath === '/animations.ts') return files['/animations.ts'];
            throw new Error(`File not found: ${filePath}`);
          },
          exists: (filePath) => filePath === '/animations.ts',
        },
        transformFunctionCache,
        transformDynamicColorCache: {},
        importAliases: { '#/': '/' },
        dev: true,
      });

    const first = transformComponent();
    expect(first.styleDependencies).toEqual(['/animations.ts']);
    expect(first.css).toMatchInlineSnapshot(`
      ".v1l918vr-1-style {
        animation: v1gz5uqy-1-fadeIn 1s;
      }"
    `);

    files['/animations.ts'] = dedent`
      import { css, keyframes } from 'vindur'

      export const base = css\`
        color: red;
      \`

      export const fadeIn = keyframes\`
        from { opacity: 0; }
        to { opacity: 1; }
      \`
    `;
    invalidateTransformCache(transformFunctionCache, '/animations.ts');

    expect(transformComponent().css).toMatchInlineSnapshot(`
      ".v1l918vr-1-style {
        animation: v1gz5uqy-2-fadeIn 1s;
      }"
    `);
  });
});
