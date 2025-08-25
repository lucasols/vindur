import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
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
      "const animatedStyle = "v1560qbr-1-animatedStyle";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1gz5uqy-1 {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .v1560qbr-1-animatedStyle {
        animation: v1gz5uqy-1 0.3s ease-in-out;
        background: white;
      }
      "
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

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1gz5uqy-1 {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes v1gz5uqy-2 {
        from {
          transform: translateY(10px);
        }
        to {
          transform: translateY(0);
        }
      }

      .v1560qbr-1-Card {
        animation: v1gz5uqy-1 0.3s ease-in-out;

        &:hover {
          animation: v1gz5uqy-2 0.2s ease-out;
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
      "const animatedStyle = "v1560qbr-1-animatedStyle";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1gz5uqy-1 {
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
      }

      .v1560qbr-1-animatedStyle {
        animation: v1gz5uqy-1 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
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

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1gz5uqy-1 {
        from {
          transform: translateX(-200px);
        }
        to {
          transform: translateX(0);
        }
      }

      .v1560qbr-1-Slider {
        animation: v1gz5uqy-1 1s ease-in-out;
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
      "const localBounce = "v1560qbr-1-localBounce";
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

      @keyframes v1gz5uqy-1 {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .v1560qbr-2-Component {
        animation:
          v1gz5uqy-1 0.3s ease-in,
          v1560qbr-1-localBounce 0.6s ease-in-out infinite;
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
      [TransformError: /test.tsx: Function "unknownAnimation" not found in /animations.ts
      loc: {
        "column": 0,
        "filename": "/animations.ts",
        "line": 0,
      }]
    `,
    );
  });
});
