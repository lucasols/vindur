import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('scoped-variables-tests', {
    'App.tsx': dedent`
      import { css, styled } from "vindur";

      const themeClass = css\`
        ---primaryColor: #007bff;
        ---secondaryColor: #6c757d;
        ---spacing: 16px;
      \`;

      const buttonClass = css\`
        background: var(---primaryColor);
        padding: var(---spacing);
  
        &:hover {
          background: var(---secondaryColor);
        }
      \`;

      const cardClass = css\`
        border: 2px solid var(---primaryColor);
        padding: var(---spacing);
      \`;

      const rootTheme = css\`
        ---baseSize: 16px;
        ---primaryColor: #007bff;
        ---bgColor: #f8f9fa;
      \`;

      const darkSection = css\`
        ---bgColor: #212529;
        ---primaryColor: #0dcaf0;
        background: var(---bgColor);
        padding: calc(var(---baseSize) * 2);
      \`;

      const lightSection = css\`
        background: var(---bgColor);
        padding: calc(var(---baseSize) * 2);
      \`;

      const text = css\`
        color: var(---primaryColor);
        font-size: var(---baseSize);
      \`;

      const ThemeProvider = styled.div\`
        ---primary: #28a745;
        ---secondary: #ffc107;
        ---danger: #dc3545;
        ---spacing-sm: 8px;
      \`;

      const Button = styled.button\`
        padding: var(---spacing-sm);
        border: none;
      \`;

      const primaryClass = css\`
        background: var(---primary);
      \`;

      const secondaryClass = css\`
        background: var(---secondary);
      \`;

      const dangerClass = css\`
        background: var(---danger);
      \`;

      export default function App() {
        return (
          <div>
            <div data-testid="basic-theme" className={themeClass}>
              <button data-testid="themed-button" className={buttonClass}>Themed Button</button>
              <div data-testid="card" className={cardClass}>
                <h3>Card Title</h3>
              </div>
            </div>

            <div data-testid="nested-theme" className={rootTheme}>
              <section data-testid="light-section" className={lightSection}>
                <p data-testid="light-text" className={text}>Light theme text</p>
              </section>

              <section data-testid="dark-section" className={darkSection}>
                <p data-testid="dark-text" className={text}>Dark theme text</p>
              </section>
            </div>

            <ThemeProvider data-testid="styled-theme">
              <Button data-testid="success-button" className={primaryClass}>Success</Button>
              <Button data-testid="warning-button" className={secondaryClass}>Warning</Button>
              <Button data-testid="danger-button" className={dangerClass}>Danger</Button>
            </ThemeProvider>
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

test('should handle scoped css variables', async () => {
  const button = page.getByTestId('themed-button');
  await expect(button).toHaveCSS('background-color', 'rgb(0, 123, 255)');
  await expect(button).toHaveCSS('padding', '16px');

  await button.hover();
  await expect(button).toHaveCSS('background-color', 'rgb(108, 117, 125)');

  const card = page.getByTestId('card');
  await expect(card).toHaveCSS('border', '2px solid rgb(0, 123, 255)');
  await expect(card).toHaveCSS('padding', '16px');
});

test('should handle nested scoped variables', async () => {
  const lightSection = page.getByTestId('light-section');
  await expect(lightSection).toHaveCSS(
    'background-color',
    'rgb(248, 249, 250)',
  );
  await expect(lightSection).toHaveCSS('padding', '32px');

  const lightText = page.getByTestId('light-text');
  await expect(lightText).toHaveCSS('color', 'rgb(0, 123, 255)');
  await expect(lightText).toHaveCSS('font-size', '16px');

  const darkSection = page.getByTestId('dark-section');
  await expect(darkSection).toHaveCSS('background-color', 'rgb(33, 37, 41)');

  const darkText = page.getByTestId('dark-text');
  await expect(darkText).toHaveCSS('color', 'rgb(13, 202, 240)');
});

test('should handle scoped variables with styled components', async () => {
  const successButton = page.getByTestId('success-button');
  await expect(successButton).toHaveCSS('background-color', 'rgb(40, 167, 69)');
  await expect(successButton).toHaveCSS('padding', '8px');

  const warningButton = page.getByTestId('warning-button');
  await expect(warningButton).toHaveCSS('background-color', 'rgb(255, 193, 7)');

  const dangerButton = page.getByTestId('danger-button');
  await expect(dangerButton).toHaveCSS('background-color', 'rgb(220, 53, 69)');
});
