import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, startEnvProd, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('css-import-extension-tests', {
    'styles.ts': dedent`
      import { css } from "vindur";

      export const baseStyles = css\`
        display: flex;
        align-items: center;
        background: white;
      \`;
    `,
    'App.tsx': dedent`
      import { css } from "vindur";
      import { baseStyles } from "#src/styles";

      const styles = css\`
        \${baseStyles};
        padding: 12px 24px;
        border-radius: 4px;
        font-weight: 500;
      \`;

      export default function App() {
        return (
          <div data-testid="extended" className={styles}>Hello</div>
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

test('should extend CSS styles imported from another file', async () => {
  const el = page.getByTestId('extended');

  // Imported base styles
  await expect(el).toHaveCSS('display', 'flex');
  await expect(el).toHaveCSS('align-items', 'center');
  await expect(el).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  // Locally extended styles
  await expect(el).toHaveCSS('padding', '12px 24px');
  await expect(el).toHaveCSS('border-radius', '4px');
  await expect(el).toHaveCSS('font-weight', '500');
});

test('should extend CSS styles imported from another file (prod build)', async ({ browser }) => {
  const pageProd = await browser.newPage();
  const envProd = await startEnvProd(
    'css-import-extension-tests-prod',
    {
      'styles.ts': dedent`
        import { css } from "vindur";

        export const baseStyles = css\`
          display: flex;
          align-items: center;
          background: white;
        \`;
      `,
      'App.tsx': dedent`
        import { css } from "vindur";
        import { baseStyles } from "#src/styles";

        const styles = css\`
          \${baseStyles};
          padding: 12px 24px;
          border-radius: 4px;
          font-weight: 500;
        \`;

        export default function App() {
          return (
            <div data-testid="extended" className={styles}>Hello</div>
          );
        }
      `,
    },
  );

  await pageProd.goto(envProd.baseUrl);

  const el = pageProd.getByTestId('extended');
  await expect(el).toHaveCSS('display', 'flex');
  await expect(el).toHaveCSS('align-items', 'center');
  await expect(el).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(el).toHaveCSS('padding', '12px 24px');
  await expect(el).toHaveCSS('border-radius', '4px');
  await expect(el).toHaveCSS('font-weight', '500');

  await pageProd.close();
  await envProd.cleanup();
});
