import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('CSS import extension', () => {
  test('should extend CSS styles imported from another file', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { baseStyles } from '#/styles'

        const styles = css\`
          \${baseStyles};
          padding: 12px 24px;
          border-radius: 4px;
          font-weight: 500;
        \`

        const App = () => <div className={styles}>Hello</div>
      `,

      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          import { css } from 'vindur'

          export const baseStyles = css\`
            display: flex;
            align-items: center;
            background: white;
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1s4vg6s-1 v1560qbr-1-styles";
      const App = () => <div className={styles}>Hello</div>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1s4vg6s-1 {
        display: flex;
        align-items: center;
        background: white;
      }

      .v1560qbr-1-styles {
        padding: 12px 24px;
        border-radius: 4px;
        font-weight: 500;
      }"
    `);
  });

  test('should extend CSS styles in styled components from imports', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { buttonBase } from '#/styles'

        const Button = styled.button\`
          \${buttonBase};
          background: #007bff;
          color: white;
        \`

        const App = () => <Button>Click me</Button>
      `,

      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          import { css } from 'vindur'

          export const buttonBase = css\`
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <button className="v1s4vg6s-1 v1560qbr-1-Button">Click me</button>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1s4vg6s-1 {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }

      .v1560qbr-1-Button {
        background: #007bff;
        color: white;
      }"
    `);
  });

  test('should handle multiple imported CSS extensions', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { baseLayout, buttonStyles } from '#/styles'

        const Card = styled.div\`
          \${baseLayout};
          background: white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        \`

        const Button = styled.button\`
          \${buttonStyles};
          background: #28a745;
          color: white;
        \`

        const App = () => (
          <Card>
            <Button>Submit</Button>
          </Card>
        )
      `,

      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          import { css } from 'vindur'

          export const baseLayout = css\`
            padding: 20px;
            border-radius: 8px;
            margin: 16px;
          \`

          export const buttonStyles = css\`
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            font-weight: bold;
            cursor: pointer;
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div className="v1s4vg6s-1 v1560qbr-1-Card">
          <button className="v1s4vg6s-2 v1560qbr-2-Button">Submit</button>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1s4vg6s-1 {
        padding: 20px;
        border-radius: 8px;
        margin: 16px;
      }

      .v1s4vg6s-2 {
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        font-weight: bold;
        cursor: pointer;
      }

      .v1560qbr-1-Card {
        background: white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .v1s4vg6s-1 {
        padding: 20px;
        border-radius: 8px;
        margin: 16px;
      }

      .v1s4vg6s-2 {
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        font-weight: bold;
        cursor: pointer;
      }

      .v1560qbr-2-Button {
        background: #28a745;
        color: white;
      }"
    `);
  });

  test('should handle mixed local and imported CSS extensions', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'
        import { baseLayout } from '#/styles'

        const localStyles = css\`
          border: 2px solid #ddd;
          transition: all 0.3s ease;
        \`

        const Card = styled.div\`
          \${baseLayout};
          \${localStyles};
          background: white;
        \`

        const App = () => <Card>Content</Card>
      `,

      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          import { css } from 'vindur'

          export const baseLayout = css\`
            padding: 16px;
            border-radius: 8px;
            margin: 8px;
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const localStyles = "v1560qbr-1-localStyles";
      const App = () => (
        <div className="v1s4vg6s-1 v1560qbr-1-localStyles v1560qbr-2-Card">
          Content
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-localStyles {
        border: 2px solid #ddd;
        transition: all 0.3s ease;
      }

      .v1s4vg6s-1 {
        padding: 16px;
        border-radius: 8px;
        margin: 8px;
      }

      .v1560qbr-2-Card {
        background: white;
      }"
    `);
  });

  test('should throw error when imported CSS is not found', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'
          import { unknownStyles } from '#/styles'

          const Card = styled.div\`
            \${unknownStyles};
            background: white;
          \`
        `,
        overrideDefaultFs: createFsMock({
          'styles.ts': dedent`
            import { css } from 'vindur'

            export const baseStyles = css\`
              padding: 16px;
            \`
          `,
        }),
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: Function "unknownStyles" not found in /styles.ts]`,
    );
  });

  test('should handle CSS extension with variable interpolation in external file', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { responsiveLayout } from '#/styles'

        const Container = styled.div\`
          \${responsiveLayout};
          background: #f8f9fa;
        \`

        const App = () => <Container>Content</Container>
      `,
      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          import { css } from 'vindur'

          const maxWidth = '1200px'
          const padding = '20px'

          export const responsiveLayout = css\`
            max-width: \${maxWidth};
            padding: \${padding};
            margin: 0 auto;
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div className="v1s4vg6s-1 v1560qbr-1-Container">Content</div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1s4vg6s-1 {
        max-width: 1200px;
        padding: 20px;
        margin: 0 auto;
      }

      .v1560qbr-1-Container {
        background: #f8f9fa;
      }"
    `);
  });

  test('should throw error on direct circular import', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { css } from 'vindur'
          import { baseStyles } from '#/styles'

          export const mainStyles = css\`
            \${baseStyles};
            color: blue;
          \`
        `,
        overrideDefaultFs: createFsMock({
          'styles.ts': dedent`
            import { css } from 'vindur'
            import { mainStyles } from '#/test'

            export const baseStyles = css\`
              \${mainStyles};
              padding: 16px;
            \`
          `,
        }),
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: /styles.ts: Invalid interpolation used at \`... baseStyles = css\` ... \${mainStyles}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported]`,
    );
  });

  test('should throw error on indirect circular import', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { css } from 'vindur'
          import { styleA } from '#/fileA'

          export const mainStyles = css\`
            \${styleA};
            color: red;
          \`
        `,
        overrideDefaultFs: createFsMock({
          'fileA.ts': dedent`
            import { css } from 'vindur'
            import { styleB } from '#/fileB'

            export const styleA = css\`
              \${styleB};
              margin: 8px;
            \`
          `,
          'fileB.ts': dedent`
            import { css } from 'vindur'
            import { mainStyles } from '#/test'

            export const styleB = css\`
              \${mainStyles};
              padding: 12px;
            \`
          `,
        }),
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: /fileA.ts: Invalid interpolation used at \`... styleA = css\` ... \${styleB}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported]`,
    );
  });
});
