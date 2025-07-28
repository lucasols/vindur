import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('global-styles-tests', {
    'reset.ts': dedent`
      import { createGlobalStyle } from "vindur";

      createGlobalStyle\`
        body {
          margin: 0;
        }
  
        h1 {
          font-weight: normal;
        }
      \`;
    `,
    'theme.ts': dedent`
      import { createGlobalStyle } from "vindur";

      createGlobalStyle\`
        body {
          color: #333;
        }
  
        .highlight {
          background-color: yellow;
        }
      \`;
    `,
    'shared.ts': dedent`
      import { createGlobalStyle } from "vindur";

      createGlobalStyle\`
        .shared-class {
          color: red;
        }
      \`;
    `,
    'duplicate.ts': dedent`
      import { createGlobalStyle } from "vindur";

      createGlobalStyle\`
        .shared-class {
          color: red;
        }
      \`;
    `,
    'App.tsx': dedent`
      import { createGlobalStyle } from "vindur";
      import "#src/reset";
      import "#src/theme";
      import "#src/shared";
      import "#src/duplicate";

      createGlobalStyle\`
        body {
          background-color: #f5f5f5;
        }
  
        a {
          color: #007bff;
        }

        .container {
          max-width: 1200px;
        }
      \`;

      export default function App() {
        return (
          <div className="container">
            <h1 data-testid="title">Global Styles Applied</h1>
            <a data-testid="link" href="#">Test Link</a>
            <p data-testid="content">
              Text with <span className="highlight">highlighted</span> content
            </p>
            <p data-testid="shared" className="shared-class">Shared class content</p>
          </div>
        );
      }
    `,
  });

  await page.goto(env.baseUrl);
});

test.afterAll(async () => {
  await page.close();
  await env.cleanup();
});

test('should inject global styles', async () => {
  const body = page.locator('body');
  await expect(body).toHaveCSS('margin', '0px');
  await expect(body).toHaveCSS('background-color', 'rgb(245, 245, 245)');
  await expect(body).toHaveCSS('color', 'rgb(51, 51, 51)');

  const link = page.getByTestId('link');
  await expect(link).toHaveCSS('color', 'rgb(0, 123, 255)');
});

test('should handle multiple createGlobalStyle calls', async () => {
  const title = page.getByTestId('title');
  await expect(title).toHaveCSS('font-weight', '400');

  const container = page.locator('.container');
  await expect(container).toHaveCSS('max-width', '1200px');

  const highlight = page.locator('.highlight');
  await expect(highlight).toHaveCSS('background-color', 'rgb(255, 255, 0)');
});

test('should deduplicate identical global styles', async () => {
  const element = page.getByTestId('shared');
  await expect(element).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(element).toHaveCount(1);
});
