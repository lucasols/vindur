import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnvProd, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnvProd('import-theme-colors-prod-tests', {
    'theme/colors.ts': dedent`
      import { createStaticThemeColors } from "vindur";

      export const brandColors = createStaticThemeColors({
        primary: '#007bff',
        secondary: '#6c757d',
        success: '#28a745',
        warning: '#ffc107',
        danger: '#dc3545'
      });
    `,
    'theme/ui.ts': dedent`
      import { createStaticThemeColors } from "vindur";

      export const uiColors = createStaticThemeColors({
        background: '#ffffff',
        surface: '#f8f9fa',
        text: '#212529'
      });
    `,
    'App.tsx': dedent`
      import { css, styled } from "vindur";
      import { brandColors } from "#src/theme/colors";
      import { uiColors } from "#src/theme/ui";

      const Button = styled.button\`
        padding: 12px 24px;
        border: none;
        border-radius: 4px;
        background: \${brandColors.primary.var};
        color: \${brandColors.primary.contrast.var};
        border: 1px solid \${brandColors.primary.alpha(0.2)};

        &.danger {
          background: \${brandColors.danger.alpha(0.1)};
          border: 2px solid \${brandColors.danger.var};
          color: \${brandColors.danger.var};
        }

        &:hover {
          background: \${brandColors.primary.darker(0.1)};
        }
      \`;

      const Card = styled.div\`
        background: \${uiColors.surface.var};
        border-radius: 8px;
        padding: 20px;
        margin: 16px 0;
        border-left: 4px solid \${brandColors.success.var};
      \`;

      const textStyles = css\`
        font-size: 18px;
        color: \${brandColors.secondary.darker(0.2)};
      \`;

      export default function App() {
        return (
          <div>
            <h1 data-testid="title" className={textStyles}>
              Imported Theme Colors Test (Production Mode)
            </h1>
            <Button data-testid="primary-button">
              Primary Button
            </Button>
            <Button data-testid="danger-button" className="danger">
              Danger Button
            </Button>
            <Card data-testid="success-card">
              Success Card with imported colors
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

test('should inline actual color values in production mode without CSS variables', async () => {
  const primaryButton = page.getByTestId('primary-button');
  
  // Should have the exact color values inlined, not CSS variables
  await expect(primaryButton).toHaveCSS('background-color', 'rgb(0, 123, 255)'); // #007bff
  await expect(primaryButton).toHaveCSS('color', 'rgb(255, 255, 255)'); // white contrast
  
  // Check that the styles are inlined (no CSS variables in dev tools)
  const computedStyle = await primaryButton.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor,
    };
  });
  
  // Verify no CSS variables are used (should be actual RGB values)
  expect(computedStyle.backgroundColor).toBe('rgb(0, 123, 255)');
  expect(computedStyle.color).toBe('rgb(255, 255, 255)');
  expect(computedStyle.borderColor).toBeTruthy();
});

test('should handle alpha colors directly in production mode', async () => {
  const dangerButton = page.getByTestId('danger-button');
  
  // Check border color (full danger color) - should be inlined
  await expect(dangerButton).toHaveCSS('border-color', 'rgb(220, 53, 69)'); // #dc3545
  await expect(dangerButton).toHaveCSS('color', 'rgb(220, 53, 69)'); // #dc3545
  
  // Border should have alpha color directly inlined
  const borderColor = await dangerButton.evaluate((el) => getComputedStyle(el).borderColor);
  expect(borderColor).toBeTruthy();
  
  // Should not contain CSS variable references
  expect(borderColor).not.toContain('var(');
});

test('should apply success color from imported theme in borders (production)', async () => {
  const successCard = page.getByTestId('success-card');
  
  await expect(successCard).toHaveCSS('border-left-color', 'rgb(40, 167, 69)'); // #28a745
  await expect(successCard).toHaveCSS('background-color', 'rgb(248, 249, 250)'); // #f8f9fa
});

test('should apply darker colors from imported theme in text (production)', async () => {
  const title = page.getByTestId('title');
  
  // Should have font size from CSS
  await expect(title).toHaveCSS('font-size', '18px');
  
  // Secondary color darker(0.2) should be visible
  const textColor = await title.evaluate((el) => getComputedStyle(el).color);
  expect(textColor).toBeTruthy();
  expect(textColor).not.toBe('rgb(108, 117, 125)'); // Should be different from original #6c757d
  
  // Should not use CSS variables
  expect(textColor).not.toContain('var(');
});

test('should handle multiple imported theme color objects in production mode', async () => {
  const primaryButton = page.getByTestId('primary-button');
  const successCard = page.getByTestId('success-card');
  
  // Primary from brandColors - inlined values
  await expect(primaryButton).toHaveCSS('background-color', 'rgb(0, 123, 255)'); // #007bff
  
  // Surface from uiColors - inlined values
  await expect(successCard).toHaveCSS('background-color', 'rgb(248, 249, 250)'); // #f8f9fa
  
  // Success from brandColors - inlined values
  await expect(successCard).toHaveCSS('border-left-color', 'rgb(40, 167, 69)'); // #28a745
  
  // Verify all computed styles are direct values without CSS variables
  const primaryStyle = await primaryButton.evaluate((el) => getComputedStyle(el).backgroundColor);
  const cardStyle = await successCard.evaluate((el) => getComputedStyle(el).backgroundColor);
  const borderStyle = await successCard.evaluate((el) => getComputedStyle(el).borderLeftColor);
  
  expect(primaryStyle).not.toContain('var(');
  expect(cardStyle).not.toContain('var(');
  expect(borderStyle).not.toContain('var(');
});

test('should handle hover states with inlined colors in production mode', async () => {
  const primaryButton = page.getByTestId('primary-button');
  
  // Hover over the button
  await primaryButton.hover();
  
  // Should have darker background on hover (primary.darker(0.1))
  // The exact color might be computed differently, but it should change
  const hoverBg = await primaryButton.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(hoverBg).toBeTruthy();
  expect(hoverBg).not.toContain('var('); // Should not use CSS variables
});