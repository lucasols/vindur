import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from './testUtils';

describe('import resolution', () => {
  test('should resolve imports with .ts extension correctly', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { buttonStyles } from '#src/components';
        import { css } from 'vindur';

        const styles = css\`
          \${buttonStyles()}
          color: red;
        \`;

        export default function App() {
          return <div className={styles}>Test</div>;
        }
      `,
      overrideDefaultFs: createFsMock({
        test: {
          'components.ts': dedent`
            import { vindurFn } from 'vindur';

            export const buttonStyles = vindurFn(() => \`
              padding: 10px;
              background: blue;
            \`);
          `,
        },
      }),
      overrideDefaultImportAliases: {
        '#src': '/test',
      },
    });

    // Should successfully transform and include the imported styles
    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-1-styles";
      export default function App() {
        return <div className={styles}>Test</div>;
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        padding: 10px;
        background: blue;

        color: red;
      }
      "
    `);

    expect(result.styleDependencies).toEqual(['/test/components.ts']);
  });

  test('should resolve .tsx files correctly', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { buttonStyles } from '#src/components';
        import { css } from 'vindur';

        const styles = css\`
          \${buttonStyles()}
          color: red;
        \`;

        export default function App() {
          return <div className={styles}>Test</div>;
        }
      `,
      overrideDefaultFs: createFsMock({
        test: {
          'components.tsx': dedent`
            import { vindurFn } from 'vindur';

            export const buttonStyles = vindurFn(() => \`
              padding: 8px;
              border: 1px solid gray;
            \`);
          `,
        },
      }),
      overrideDefaultImportAliases: {
        '#src': '/test',
      },
    });

    // Should successfully transform and include the imported styles
    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-1-styles";
      export default function App() {
        return <div className={styles}>Test</div>;
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        padding: 8px;
        border: 1px solid gray;

        color: red;
      }
      "
    `);

    expect(result.styleDependencies).toEqual(['/test/components.tsx']);
  });

  test('should resolve vindurFn imports from .ts files', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { buttonMixin, primaryColor } from '#src/mixins';
        import { css } from 'vindur';

        const styles = css\`
          \${buttonMixin('large')}
          color: \${primaryColor};
        \`;

        export default function App() {
          return <div className={styles}>Test</div>;
        }
      `,
      overrideDefaultFs: createFsMock({
        test: {
          'mixins.ts': dedent`
            import { vindurFn } from 'vindur';

            export const buttonMixin = vindurFn((size: string) => \`
              padding: \${size === 'large' ? '12px' : '8px'};
              border-radius: 4px;
            \`);

            export const primaryColor = '#007bff';
          `,
        },
      }),
      overrideDefaultImportAliases: {
        '#src': '/test',
      },
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-1-styles";
      export default function App() {
        return <div className={styles}>Test</div>;
      }
      "
    `);
    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        padding: 12px;
        border-radius: 4px;

        color: #007bff;
      }
      "
    `);
    expect(result.styleDependencies).toEqual(['/test/mixins.ts']);
  });

  test('should track style dependencies for imported files', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { utilStyles } from '#src/utils';
        import { css } from 'vindur';

        const styles = css\`
          \${utilStyles()}
          margin: 10px;
        \`;

        export default function App() {
          return <div className={styles}>Test</div>;
        }
      `,
      overrideDefaultFs: createFsMock({
        test: {
          'utils.ts': dedent`
            import { vindurFn } from 'vindur';

            export const utilStyles = vindurFn(() => \`
              display: flex;
              align-items: center;
            \`);
          `,
        },
      }),
      overrideDefaultImportAliases: {
        '#src': '/test',
      },
    });

    // Should track the imported file as a dependency
    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-1-styles";
      export default function App() {
        return <div className={styles}>Test</div>;
      }
      "
    `);
    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        display: flex;
        align-items: center;

        margin: 10px;
      }
      "
    `);
    expect(result.styleDependencies).toEqual(['/test/utils.ts']);
  });

  test('should handle multiple imports from same aliased path', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { flexCenter, textLarge, primaryButton } from '#src/shared';
        import { css } from 'vindur';

        const containerStyles = css\`
          \${flexCenter()}
          padding: 20px;
        \`;

        const titleStyles = css\`
          \${textLarge()}
          margin-bottom: 10px;
        \`;

        const buttonStyles = css\`
          \${primaryButton()}
        \`;

        export default function App() {
          return (
            <div className={containerStyles}>
              <h1 className={titleStyles}>Title</h1>
              <button className={buttonStyles}>Click me</button>
            </div>
          );
        }
      `,
      overrideDefaultFs: createFsMock({
        test: {
          'shared.ts': dedent`
            import { vindurFn } from 'vindur';

            export const flexCenter = vindurFn(() => \`
              display: flex;
              justify-content: center;
              align-items: center;
            \`);

            export const textLarge = vindurFn(() => \`
              font-size: 1.5rem;
              font-weight: bold;
            \`);

            export const primaryButton = vindurFn(() => \`
              background: #007bff;
              color: white;
              border: none;
              padding: 8px 16px;
              border-radius: 4px;
            \`);
          `,
        },
      }),
      overrideDefaultImportAliases: {
        '#src': '/test',
      },
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const containerStyles = "v1560qbr-1-containerStyles";
      const titleStyles = "v1560qbr-2-titleStyles";
      const buttonStyles = "v1560qbr-3-buttonStyles";
      export default function App() {
        return (
          <div className={containerStyles}>
            <h1 className={titleStyles}>Title</h1>
            <button className={buttonStyles}>Click me</button>
          </div>
        );
      }
      "
    `);
    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-containerStyles {
        display: flex;
        justify-content: center;
        align-items: center;

        padding: 20px;
      }

      .v1560qbr-2-titleStyles {
        font-size: 1.5rem;
        font-weight: bold;

        margin-bottom: 10px;
      }

      .v1560qbr-3-buttonStyles {
        background: #007bff;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
      }
      "
    `);
    expect(result.styleDependencies).toEqual(['/test/shared.ts']);
  });

  test('should handle imports with no alias (should be ignored)', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { someFunction } from './local-file';
        import { css } from 'vindur';

        const styles = css\`
          color: red;
          padding: 10px;
        \`;

        export default function App() {
          return <div className={styles}>Test</div>;
        }
      `,
      overrideDefaultFs: createFsMock({}),
      overrideDefaultImportAliases: {
        '#src': '/test',
      },
    });

    // Should process vindur styles normally but ignore non-alias imports
    expect(result.code).toMatchInlineSnapshot(`
      "import { someFunction } from "./local-file";
      const styles = "v1560qbr-1-styles";
      export default function App() {
        return <div className={styles}>Test</div>;
      }
      "
    `);
    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        color: red;
        padding: 10px;
      }
      "
    `);

    // Should not have any style dependencies since './local-file' is not an alias
    expect(result.styleDependencies).toEqual([]);
  });
});
