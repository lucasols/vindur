import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('style-extension-tests', {
    'App.tsx': dedent`
      import { styled, css } from "vindur";

      const BaseButton = styled.button\`
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        font-weight: 500;
        cursor: pointer;
        background: #f8f9fa;
        color: #212529;
      \`;

      const PrimaryButton = styled(BaseButton)\`
        background: #007bff;
        color: white;
  
        &:hover {
          background: #0056b3;
        }
      \`;

      const LargeButton = styled(BaseButton)\`
        padding: 12px 24px;
        font-size: 18px;
      \`;

      const DangerButton = styled(PrimaryButton)\`
        background: #dc3545;
  
        &:hover {
          background: #c82333;
        }
      \`;

      const baseStyles = css\`
        padding: 10px;
        margin: 5px;
        border-radius: 4px;
      \`;

      const extendedStyles = css\`
        \${baseStyles};
        background: #e9ecef;
        border: 1px solid #ced4da;
      \`;

      const Card = styled.div\`
        \${extendedStyles};
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      \`;

      export default function App() {
        return (
          <div>
            <BaseButton data-testid="base-button">
              Base Button
            </BaseButton>

            <PrimaryButton data-testid="primary-button">
              Primary Button
            </PrimaryButton>

            <LargeButton data-testid="large-button">
              Large Button
            </LargeButton>

            <DangerButton data-testid="danger-button">
              Danger Button
            </DangerButton>

            <div data-testid="base-styles" className={baseStyles}>
              Base Styles
            </div>

            <div data-testid="extended-styles" className={extendedStyles}>
              Extended Styles
            </div>

            <Card data-testid="card-component">
              Card Component
            </Card>
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

test('should extend styled components correctly', async () => {
  const baseButton = page.getByTestId('base-button');
  const primaryButton = page.getByTestId('primary-button');

  // Base button should have base styles
  await expect(baseButton).toHaveCSS('padding', '8px 16px');
  await expect(baseButton).toHaveCSS('background-color', 'rgb(248, 249, 250)'); // #f8f9fa

  // Primary button should inherit base styles but override background
  await expect(primaryButton).toHaveCSS('padding', '8px 16px'); // inherited
  await expect(primaryButton).toHaveCSS('background-color', 'rgb(0, 123, 255)'); // #007bff overridden
  await expect(primaryButton).toHaveCSS('color', 'rgb(255, 255, 255)'); // white overridden
});

test('should handle multiple levels of extension', async () => {
  const dangerButton = page.getByTestId('danger-button');

  // Should inherit from PrimaryButton which inherits from BaseButton
  await expect(dangerButton).toHaveCSS('padding', '8px 16px'); // from BaseButton
  await expect(dangerButton).toHaveCSS('color', 'rgb(255, 255, 255)'); // from PrimaryButton
  await expect(dangerButton).toHaveCSS('background-color', 'rgb(220, 53, 69)'); // #dc3545 from DangerButton
});

test('should handle property-specific extensions', async () => {
  const largeButton = page.getByTestId('large-button');

  // Should inherit base styles but override size-related properties
  await expect(largeButton).toHaveCSS('background-color', 'rgb(248, 249, 250)'); // inherited
  await expect(largeButton).toHaveCSS('padding', '12px 24px'); // overridden
  await expect(largeButton).toHaveCSS('font-size', '18px'); // added
});

test('should extend CSS template literals', async () => {
  const baseStyles = page.getByTestId('base-styles');
  const extendedStyles = page.getByTestId('extended-styles');

  // Base styles
  await expect(baseStyles).toHaveCSS('padding', '10px');
  await expect(baseStyles).toHaveCSS('margin', '5px');

  // Extended styles should include base styles plus additions
  await expect(extendedStyles).toHaveCSS('padding', '10px'); // inherited from baseStyles
  await expect(extendedStyles).toHaveCSS('margin', '5px'); // inherited from baseStyles
  await expect(extendedStyles).toHaveCSS(
    'background-color',
    'rgb(233, 236, 239)',
  ); // #e9ecef added
  await expect(extendedStyles).toHaveCSS('border-width', '1px'); // added
});

test('should combine extension with styled components', async () => {
  const cardComponent = page.getByTestId('card-component');

  // Should have styles from baseStyles + extendedStyles + Card-specific styles
  await expect(cardComponent).toHaveCSS('padding', '10px'); // from baseStyles
  await expect(cardComponent).toHaveCSS('margin', '5px'); // from baseStyles
  await expect(cardComponent).toHaveCSS(
    'background-color',
    'rgb(233, 236, 239)',
  ); // from extendedStyles
  await expect(cardComponent).toHaveCSS('border-width', '1px'); // from extendedStyles
  await expect(cardComponent).toHaveCSS(
    'box-shadow',
    'rgba(0, 0, 0, 0.1) 0px 2px 4px 0px',
  ); // from Card
});

test('should support hover states in extended components', async () => {
  const primaryButton = page.getByTestId('primary-button');
  const dangerButton = page.getByTestId('danger-button');

  // Test primary button hover
  await expect(primaryButton).toHaveCSS('background-color', 'rgb(0, 123, 255)'); // initial
  await primaryButton.hover();
  await expect(primaryButton).toHaveCSS('background-color', 'rgb(0, 86, 179)'); // #0056b3 on hover

  // Test danger button hover (should override primary hover)
  await expect(dangerButton).toHaveCSS('background-color', 'rgb(220, 53, 69)'); // initial
  await dangerButton.hover();
  await expect(dangerButton).toHaveCSS('background-color', 'rgb(200, 35, 51)'); // #c82333 on hover
});
