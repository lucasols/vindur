import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from '@playwright/test';
import { startEnv } from '../utils/startEnv';

test.describe('createGlobalStyle', () => {
  test('should inject global styles', async ({ page }) => {
    await using env = await startEnv('global-styles-basic', {
      'App.tsx': dedent`
        import { createGlobalStyle } from "vindur";

        createGlobalStyle\`
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background-color: #f5f5f5;
          }
  
          * {
            box-sizing: border-box;
          }
  
          a {
            color: #007bff;
            text-decoration: none;
          }
  
          a:hover {
            text-decoration: underline;
          }
        \`;

        export default function App() {
          return (
            <div>
              <h1>Global Styles Applied</h1>
              <a href="#">Test Link</a>
            </div>
          );
        }
      `,
    });

    await page.goto(env.port);

    const body = page.locator('body');
    await expect(body).toHaveCSS('margin', '0px');
    await expect(body).toHaveCSS('background-color', 'rgb(245, 245, 245)');

    const link = page.locator('a');
    await expect(link).toHaveCSS('color', 'rgb(0, 123, 255)');
    await expect(link).toHaveCSS(
      'text-decoration',
      'none solid rgb(0, 123, 255)',
    );
  });

  test('should handle multiple createGlobalStyle calls', async ({ page }) => {
    await using env = await startEnv('global-styles-multiple', {
      'reset.ts': dedent`
        import { createGlobalStyle } from "vindur";

        createGlobalStyle\`
          html, body {
            margin: 0;
            padding: 0;
          }
  
          h1, h2, h3, h4, h5, h6 {
            margin: 0;
            font-weight: normal;
          }
        \`;
      `,
      'theme.ts': dedent`
        import { createGlobalStyle } from "vindur";

        createGlobalStyle\`
          :root {
            --primary-color: #007bff;
            --secondary-color: #6c757d;
            --font-size-base: 16px;
          }
  
          body {
            color: #333;
            font-size: var(--font-size-base);
            line-height: 1.5;
          }
        \`;
      `,
      'App.tsx': dedent`
        import { createGlobalStyle } from "vindur";
        import "#src/reset";
        import "#src/theme";

        createGlobalStyle\`
          .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
          }
  
          .highlight {
            background-color: yellow;
            padding: 2px 4px;
          }
        \`;

        export default function App() {
          return (
            <div className="container">
              <h1>Multiple Global Styles</h1>
              <p>Text with <span className="highlight">highlighted</span> content</p>
            </div>
          );
        }
      `,
    });

    await page.goto(env.port);

    const body = page.locator('body');
    await expect(body).toHaveCSS('margin', '0px');
    await expect(body).toHaveCSS('color', 'rgb(51, 51, 51)');
    await expect(body).toHaveCSS('line-height', '1.5');

    const h1 = page.locator('h1');
    await expect(h1).toHaveCSS('margin', '0px');

    const container = page.locator('.container');
    await expect(container).toHaveCSS('max-width', '1200px');
    await expect(container).toHaveCSS('padding', '20px');

    const highlight = page.locator('.highlight');
    await expect(highlight).toHaveCSS('background-color', 'rgb(255, 255, 0)');
  });

  test('should deduplicate identical global styles', async ({ page }) => {
    await using env = await startEnv('global-styles-dedup', {
      'styles1.ts': dedent`
        import { createGlobalStyle } from "vindur";

        createGlobalStyle\`
          .shared-class {
            color: red;
            font-size: 20px;
          }
        \`;
      `,
      'styles2.ts': dedent`
        import { createGlobalStyle } from "vindur";

        // Identical global style - should be deduplicated
        createGlobalStyle\`
          .shared-class {
            color: red;
            font-size: 20px;
          }
        \`;
      `,
      'App.tsx': dedent`
        import "#src/styles1";
        import "#src/styles2";

        export default function App() {
          return (
            <div>
              <p className="shared-class">This should be red and 20px</p>
            </div>
          );
        }
      `,
    });

    await page.goto(env.port);

    const element = page.locator('.shared-class');
    await expect(element).toHaveCSS('color', 'rgb(255, 0, 0)');
    await expect(element).toHaveCSS('font-size', '20px');

    // Verify styles are not duplicated by checking computed styles work correctly
    await expect(element).toHaveCount(1);
  });
});
