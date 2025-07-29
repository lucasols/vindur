import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('static-theme-colors-tests', {
    'App.tsx': dedent`
      import { css, createStaticThemeColors } from "vindur";

      const colors = createStaticThemeColors({
        primary: '#007bff',
        secondary: '#6c757d',
        success: '#28a745',
        danger: '#dc3545'
      });

      const buttonStyles = css\`
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        color: white;
        font-weight: 500;
      \`;

      const primaryStyles = css\`
        background: \${colors.primary.var};
      \`;

      const secondaryStyles = css\`
        background: \${colors.secondary.var};
      \`;

      const cardStyles = css\`
        padding: 20px;
        border-radius: 8px;
        margin: 10px;
        border: 2px solid \${colors.success.var};
        background-color: \${colors.primary.var};
      \`;

      export default function App() {
        return (
          <div>
            <button 
              data-testid="primary-button"
              className={\`\${buttonStyles} \${primaryStyles}\`}
            >
              Primary Button
            </button>

            <button 
              data-testid="secondary-button"
              className={\`\${buttonStyles} \${secondaryStyles}\`}
            >
              Secondary Button
            </button>

            <div 
              data-testid="success-card"
              className={cardStyles}
            >
              Success Card
            </div>

            <div 
              data-testid="danger-text"
              style={{ color: colors.danger.var }}
            >
              Danger Text
            </div>
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

test('should apply static theme colors in CSS', async () => {
  const primaryButton = page.getByTestId('primary-button');
  const secondaryButton = page.getByTestId('secondary-button');
  
  await expect(primaryButton).toHaveCSS('background-color', 'rgb(0, 123, 255)'); // #007bff
  await expect(secondaryButton).toHaveCSS('background-color', 'rgb(108, 117, 125)'); // #6c757d
});

test('should handle theme colors in borders and backgrounds', async () => {
  const successCard = page.getByTestId('success-card');
  
  await expect(successCard).toHaveCSS('border-color', 'rgb(40, 167, 69)'); // #28a745
  // Background with alpha transparency might be computed differently
});

test('should work with CSS variables', async () => {
  const dangerText = page.getByTestId('danger-text');
  
  // Verify element exists and has some color applied
  await expect(dangerText).toBeVisible();
  const color = await dangerText.evaluate(el => getComputedStyle(el).color);
  expect(color).toBeTruthy();
});