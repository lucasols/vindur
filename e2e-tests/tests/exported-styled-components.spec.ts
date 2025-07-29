import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('exported-styled-components-tests', {
    'components.ts': dedent`
      import { styled } from "vindur";

      export const ExportedButton = styled.button\`
        padding: 12px 24px;
        border: none;
        border-radius: 6px;
        background: #007bff;
        color: white;
        font-weight: 600;
        cursor: pointer;

        &:hover {
          background: #0056b3;
        }
      \`;

      export const ExportedCard = styled.div\`
        padding: 20px;
        border-radius: 8px;
        background: #f8f9fa;
        border: 1px solid #dee2e6;
        margin: 10px 0;
      \`;

      const NonExportedDiv = styled.div\`
        background: #28a745;
        padding: 15px;
        color: white;
        border-radius: 4px;
      \`;

      export { NonExportedDiv as ExportedDiv };
    `,
    'App.tsx': dedent`
      import { styled } from "vindur";
      import { ExportedButton, ExportedCard, ExportedDiv } from "#src/components";

      const LocalButton = styled.button\`
        padding: 8px 16px;
        border: none;
        background: #dc3545;
        color: white;
        border-radius: 4px;
      \`;

      export default function App() {
        return (
          <div>
            <ExportedButton data-testid="exported-button">
              Exported Button
            </ExportedButton>

            <ExportedCard data-testid="exported-card">
              <h3>Exported Card</h3>
              <p>This is content inside an exported styled component.</p>
            </ExportedCard>

            <ExportedDiv data-testid="exported-div">
              Re-exported Component
            </ExportedDiv>

            <LocalButton data-testid="local-button">
              Local Button
            </LocalButton>
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

test('should render exported styled components correctly', async () => {
  const exportedButton = page.getByTestId('exported-button');
  const exportedCard = page.getByTestId('exported-card');
  
  await expect(exportedButton).toHaveCSS('background-color', 'rgb(0, 123, 255)'); // #007bff
  await expect(exportedButton).toHaveCSS('padding', '12px 24px');
  await expect(exportedButton).toHaveCSS('font-weight', '600');
  
  await expect(exportedCard).toHaveCSS('background-color', 'rgb(248, 249, 250)'); // #f8f9fa
  await expect(exportedCard).toHaveCSS('border-width', '1px');
});

test('should handle re-exported styled components', async () => {
  const exportedDiv = page.getByTestId('exported-div');
  
  await expect(exportedDiv).toHaveCSS('background-color', 'rgb(40, 167, 69)'); // #28a745
  await expect(exportedDiv).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('should differentiate between exported and local components', async () => {
  const localButton = page.getByTestId('local-button');
  
  await expect(localButton).toHaveCSS('background-color', 'rgb(220, 53, 69)'); // #dc3545
  await expect(localButton).toHaveCSS('padding', '8px 16px');
});

test('should support hover states on exported components', async () => {
  const exportedButton = page.getByTestId('exported-button');
  
  // Initial state
  await expect(exportedButton).toHaveCSS('background-color', 'rgb(0, 123, 255)'); // #007bff
  
  // Hover state
  await exportedButton.hover();
  await expect(exportedButton).toHaveCSS('background-color', 'rgb(0, 86, 179)'); // #0056b3
});