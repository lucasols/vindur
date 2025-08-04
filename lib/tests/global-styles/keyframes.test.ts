import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('keyframes basic functionality', () => {
  test('should transform keyframes styles', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        const slideIn = keyframes\`
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(0);
          }
        \`

        console.log(slideIn)
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const slideIn = "v1560qbr-1-slideIn";
      console.log(slideIn);
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1560qbr-1-slideIn {
        from {
          transform: translateX(-100%);
        }
        to {
          transform: translateX(0);
        }
      }
      "
    `);
  });

  test('should transform keyframes with percentage stops', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        const fadeInOut = keyframes\`
          0% {
            opacity: 0;
          }
          50% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const fadeInOut = "v1560qbr-1-fadeInOut";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1560qbr-1-fadeInOut {
        0% {
          opacity: 0;
        }
        50% {
          opacity: 1;
        }
        100% {
          opacity: 0;
        }
      }
      "
    `);
  });

  test('should transform keyframes in dev mode with variable names', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        const bounceAnimation = keyframes\`
          0%, 20%, 50%, 80%, 100% {
            transform: translateY(0);
          }
          40% {
            transform: translateY(-30px);
          }
          60% {
            transform: translateY(-15px);
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const bounceAnimation = "v1560qbr-1-bounceAnimation";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1560qbr-1-bounceAnimation {
        0%,
        20%,
        50%,
        80%,
        100% {
          transform: translateY(0);
        }
        40% {
          transform: translateY(-30px);
        }
        60% {
          transform: translateY(-15px);
        }
      }
      "
    `);
  });
});

describe('keyframes interpolation', () => {
  test('should handle variable interpolation in keyframes', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        const startPosition = '0'
        const endPosition = '100px'

        const moveRight = keyframes\`
          from {
            left: \${startPosition};
          }
          to {
            left: \${endPosition};
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const startPosition = "0";
      const endPosition = "100px";
      const moveRight = "v1560qbr-1-moveRight";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1560qbr-1-moveRight {
        from {
          left: 0;
        }
        to {
          left: 100px;
        }
      }
      "
    `);
  });

  test('should handle number interpolation in keyframes', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        const startOpacity = 0
        const endOpacity = 1

        const fadeIn = keyframes\`
          from {
            opacity: \${startOpacity};
          }
          to {
            opacity: \${endOpacity};
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const startOpacity = 0;
      const endOpacity = 1;
      const fadeIn = "v1560qbr-1-fadeIn";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1560qbr-1-fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      "
    `);
  });
});

describe('keyframes error handling', () => {
  test('should throw error for complex expressions in keyframes interpolation', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { keyframes } from 'vindur'

          const obj = { start: 0, end: 100 }

          const animation = keyframes\`
            from {
              left: \${obj.start}px;
            }
            to {
              left: \${obj.end}px;
            }
          \`
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[TransformError: /test.tsx: Invalid interpolation used at \`... animation = css\` ... \${obj.start}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported]`,
    );
  });

  test('should throw error for undefined variable references in keyframes', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { keyframes } from 'vindur'

          const animation = keyframes\`
            from {
              opacity: \${undefinedVariable};
            }
            to {
              opacity: 1;
            }
          \`
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[TransformError: /test.tsx: Invalid interpolation used at \`... animation = css\` ... \${undefinedVariable}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported]`,
    );
  });
});

describe('keyframes corner cases', () => {
  test('should handle empty keyframes', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        const empty = keyframes\`\`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const empty = "v1560qbr-1-empty";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('should handle keyframes with only whitespace', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        const whitespace = keyframes\`
  
  
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const whitespace = "v1560qbr-1-whitespace";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('should handle multiple keyframes in one file', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        const fade = keyframes\`from { opacity: 0; } to { opacity: 1; }\`
        const slide = keyframes\`from { left: 0; } to { left: 100px; }\`
        const rotate = keyframes\`from { transform: rotate(0deg); } to { transform: rotate(360deg); }\`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const fade = "v1560qbr-1-fade";
      const slide = "v1560qbr-2-slide";
      const rotate = "v1560qbr-3-rotate";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1560qbr-1-fade {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes v1560qbr-2-slide {
        from {
          left: 0;
        }
        to {
          left: 100px;
        }
      }

      @keyframes v1560qbr-3-rotate {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
      "
    `);
  });

  test('should handle direct keyframes usage without assignment', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { keyframes } from 'vindur'

        console.log(keyframes\`from { opacity: 0; } to { opacity: 1; }\`)
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "console.log("v1560qbr-1");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1560qbr-1 {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      "
    `);
  });
});
