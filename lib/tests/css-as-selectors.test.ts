import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from './testUtils';

describe('CSS as selectors', () => {
  test('should use CSS styles as selectors with & operator', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const baseStyles = css\`
          padding: 12px 24px;
          border-radius: 4px;
          font-weight: 500;
        \`

        const Container = styled.div\`
          padding: 20px;

          \${baseStyles} & {
            background: #f0f0f0;
            border: 1px solid #ddd;
          }

          &:hover \${baseStyles} {
            background: #007bff;
            color: white;
          }
        \`

        const App = () => (
          <Container>
            <button className={baseStyles}>Click me</button>
          </Container>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const baseStyles = "v1560qbr-1";
      const App = () => (
        <div className="v1560qbr-2">
          <button className={baseStyles}>Click me</button>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        padding: 12px 24px;
        border-radius: 4px;
        font-weight: 500;
      }

      .v1560qbr-2 {
        padding: 20px;

        .v1560qbr-1 & {
          background: #f0f0f0;
          border: 1px solid #ddd;
        }

        &:hover .v1560qbr-1 {
          background: #007bff;
          color: white;
        }
      }"
    `);
  });

  test('should handle multiple CSS selectors in nested patterns', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const buttonStyle = css\`
          padding: 8px 16px;
          border: none;
          cursor: pointer;
        \`

        const cardStyle = css\`
          background: white;
          border-radius: 8px;
          padding: 16px;
        \`

        const Layout = styled.div\`
          display: flex;
          gap: 16px;

          \${cardStyle} & {
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }

          \${cardStyle} \${buttonStyle} {
            border-radius: 4px;
          }

          &:hover \${cardStyle} \${buttonStyle} {
            transform: scale(1.05);
          }
        \`

        const App = () => (
          <Layout>
            <div className={cardStyle}>
              <button className={buttonStyle}>Action</button>
            </div>
          </Layout>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const buttonStyle = "v1560qbr-1";
      const cardStyle = "v1560qbr-2";
      const App = () => (
        <div className="v1560qbr-3">
          <div className={cardStyle}>
            <button className={buttonStyle}>Action</button>
          </div>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        padding: 8px 16px;
        border: none;
        cursor: pointer;
      }

      .v1560qbr-2 {
        background: white;
        border-radius: 8px;
        padding: 16px;
      }

      .v1560qbr-3 {
        display: flex;
        gap: 16px;

        .v1560qbr-2 & {
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .v1560qbr-2 .v1560qbr-1 {
          border-radius: 4px;
        }

        &:hover .v1560qbr-2 .v1560qbr-1 {
          transform: scale(1.05);
        }
      }"
    `);
  });

  test('should handle CSS selectors with pseudo-classes and combinators', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const linkStyle = css\`
          color: #007bff;
          text-decoration: none;
        \`

        const Navigation = styled.nav\`
          ul {
            list-style: none;
            padding: 0;
          }

          li \${linkStyle}:hover {
            text-decoration: underline;
          }

          li \${linkStyle}:active {
            color: #0056b3;
          }

          \${linkStyle}.active {
            font-weight: bold;
          }
        \`

        const App = () => (
          <Navigation>
            <ul>
              <li><a className={linkStyle} href="#">Home</a></li>
              <li><a className={\`\${linkStyle} active\`} href="#">Current</a></li>
            </ul>
          </Navigation>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const linkStyle = "v1560qbr-1";
      const App = () => (
        <nav className="v1560qbr-2">
          <ul>
            <li>
              <a className={linkStyle} href="#">
                Home
              </a>
            </li>
            <li>
              <a className={\`\${linkStyle} active\`} href="#">
                Current
              </a>
            </li>
          </ul>
        </nav>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        color: #007bff;
        text-decoration: none;
      }

      .v1560qbr-2 {
        ul {
          list-style: none;
          padding: 0;
        }

        li .v1560qbr-1:hover {
          text-decoration: underline;
        }

        li .v1560qbr-1:active {
          color: #0056b3;
        }

        .v1560qbr-1.active {
          font-weight: bold;
        }
      }"
    `);
  });

  test('should throw error when using undefined CSS variable as selector', async () => {
    await expect(async () => {
      await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Container = styled.div\`
            \${undefinedStyle} & {
              background: red;
            }
          \`
        `,
      });
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: /test.tsx: Invalid interpolation used at \`... Container = styled\` ... \${undefinedStyle}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported]`,
    );
  });

  test('should handle CSS selectors mixed with other interpolations', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const inputStyle = css\`
          padding: 8px 12px;
          border: 1px solid #ccc;
          border-radius: 4px;
        \`

        const primaryColor = '#007bff'

        const Form = styled.form\`
          max-width: 400px;
          margin: 0 auto;

          \${inputStyle} {
            width: 100%;
            margin-bottom: 16px;
          }

          \${inputStyle}:focus {
            border-color: \${primaryColor};
            outline: none;
          }

          button {
            background: \${primaryColor};
            color: white;
          }
        \`

        const App = () => (
          <Form>
            <input className={inputStyle} type="text" placeholder="Name" />
            <button type="submit">Submit</button>
          </Form>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const inputStyle = "v1560qbr-1";
      const primaryColor = "#007bff";
      const App = () => (
        <form className="v1560qbr-2">
          <input className={inputStyle} type="text" placeholder="Name" />
          <button type="submit">Submit</button>
        </form>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        padding: 8px 12px;
        border: 1px solid #ccc;
        border-radius: 4px;
      }

      .v1560qbr-2 {
        max-width: 400px;
        margin: 0 auto;

        .v1560qbr-1 {
          width: 100%;
          margin-bottom: 16px;
        }

        .v1560qbr-1:focus {
          border-color: #007bff;
          outline: none;
        }

        button {
          background: #007bff;
          color: white;
        }
      }"
    `);
  });
});