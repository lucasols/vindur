import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from './testUtils';

describe('CSS style extension', () => {
  test('should extend CSS styles in styled components with semicolon syntax', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const baseStyles = css\`
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #ddd;
        \`

        const Card = styled.div\`
          \${baseStyles};
          background: white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        \`

        const App = () => <Card>Hello</Card>
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const baseStyles = "v1560qbr-1";
      const App = () => <div className="v1560qbr-1 v1560qbr-2">Hello</div>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        padding: 16px;
        border-radius: 8px;
        border: 1px solid #ddd;
      }

      .v1560qbr-2 {
        background: white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }"
    `);
  });

  test('should extend CSS styles in css function with semicolon syntax', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const baseStyles = css\`
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #ddd;
        \`

        const extendedStyles = css\`
          \${baseStyles};
          background: white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        \`

        const App = () => <div className={extendedStyles}>Hello</div>
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const baseStyles = "v1560qbr-1";
      const extendedStyles = "v1560qbr-1 v1560qbr-2";
      const App = () => <div className={extendedStyles}>Hello</div>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        padding: 16px;
        border-radius: 8px;
        border: 1px solid #ddd;
      }

      .v1560qbr-2 {
        background: white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }"
    `);
  });

  test('should handle multiple CSS style extensions', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const baseStyles = css\`
          padding: 16px;
          border-radius: 8px;
        \`

        const Card = styled.div\`
          \${baseStyles};
          background: white;
          border: 1px solid #ddd;
        \`

        const PrimaryCard = styled.div\`
          \${baseStyles};
          background: #007bff;
          color: white;
        \`

        const App = () => (
          <div>
            <Card>Card</Card>
            <PrimaryCard>Primary</PrimaryCard>
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const baseStyles = "v1560qbr-1";
      const App = () => (
        <div>
          <div className="v1560qbr-1 v1560qbr-2">Card</div>
          <div className="v1560qbr-1 v1560qbr-3">Primary</div>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        padding: 16px;
        border-radius: 8px;
      }

      .v1560qbr-2 {
        background: white;
        border: 1px solid #ddd;
      }

      .v1560qbr-3 {
        background: #007bff;
        color: white;
      }"
    `);
  });

  test('should throw error when extending undefined CSS variable', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Card = styled.div\`
            \${undefinedStyles};
            background: white;
          \`
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: Invalid interpolation used at \`... Card = styled\` ... \${undefinedStyles}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported]`,
    );
  });

  test('should handle mixed extension and normal interpolation', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const baseStyles = css\`
          padding: 16px;
          border-radius: 8px;
        \`

        const primaryColor = '#007bff'

        const Button = styled.button\`
          \${baseStyles};
          background: \${primaryColor};
          color: white;
          border: none;
          cursor: pointer;
        \`

        const App = () => <Button>Click me</Button>
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const baseStyles = "v1560qbr-1";
      const primaryColor = "#007bff";
      const App = () => <button className="v1560qbr-1 v1560qbr-2">Click me</button>;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        padding: 16px;
        border-radius: 8px;
      }

      .v1560qbr-2 {
        background: #007bff;
        color: white;
        border: none;
        cursor: pointer;
      }"
    `);
  });
});