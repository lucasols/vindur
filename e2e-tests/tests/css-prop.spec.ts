import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('css-prop-tests', {
    'App.tsx': dedent`
      import { styled, css } from "vindur";

      const BaseButton = styled.button\`
        padding: 8px 16px;
        border: none;
      \`;

      const baseClass = css\`
        padding: 10px;

        &.extra {
          font-size: 16px;
        }
      \`;

      export default function App() {
        return (
          <div>
            <div 
              data-testid="native-container"
              css={\`background: #f0f0f0;\`}
            >
              <h1 data-testid="native-title" css={\`color: #333;\`}>Title</h1>
              <button 
                data-testid="native-button"
                css={\`
                  background: #007bff;
    
                  &:hover {
                    background: #0056b3;
                  }
                \`}
              >
                Click me
              </button>
            </div>

            <BaseButton 
              data-testid="styled-success"
              css={\`
                background: #28a745;
  
                &:hover {
                  background: #218838;
                }
              \`}
            >
              Success
            </BaseButton>

            <BaseButton 
              data-testid="styled-danger"
              css={\`background: #dc3545;\`}
            >
              Danger
            </BaseButton>

            <div 
              data-testid="merged-element"
              className={baseClass}
              css={\`
                background: #e3f2fd;
                color: #1976d2;
              \`}
            >
              Merged styles
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

test('should handle css prop on native elements', async () => {
  const container = page.getByTestId('native-container');
  await expect(container).toHaveCSS('background-color', 'rgb(240, 240, 240)');

  const title = page.getByTestId('native-title');
  await expect(title).toHaveCSS('color', 'rgb(51, 51, 51)');

  const button = page.getByTestId('native-button');
  await expect(button).toHaveCSS('background-color', 'rgb(0, 123, 255)');
  await button.hover();
  await expect(button).toHaveCSS('background-color', 'rgb(0, 86, 179)');
});

test('should handle css prop with styled components', async () => {
  const successButton = page.getByTestId('styled-success');
  await expect(successButton).toHaveCSS('background-color', 'rgb(40, 167, 69)');
  await expect(successButton).toHaveCSS('padding', '8px 16px');

  const dangerButton = page.getByTestId('styled-danger');
  await expect(dangerButton).toHaveCSS('background-color', 'rgb(220, 53, 69)');
});

test('should merge css prop with existing className', async () => {
  const element = page.getByTestId('merged-element');
  await expect(element).toHaveCSS('padding', '10px');
  await expect(element).toHaveCSS('background-color', 'rgb(227, 242, 253)');
  await expect(element).toHaveCSS('color', 'rgb(25, 118, 210)');
});
