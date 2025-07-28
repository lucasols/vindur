import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from '@playwright/test';
import { startEnv } from '../utils/startEnv';

test.describe('css prop', () => {
  test('should handle css prop on native elements', async ({ page }) => {
    await using env = await startEnv('css-prop-native', {
      'App.tsx': dedent`
        import "vindur";

        export default function App() {
          return (
            <div>
              <div css={\`
                background: #f0f0f0;
                padding: 20px;
                border-radius: 8px;
              \`}>
                <h1 css={\`color: #333; font-size: 24px;\`}>Title</h1>
                <p css={\`color: #666; line-height: 1.6;\`}>Content</p>
                <button css={\`
                  background: #007bff;
                  color: white;
                  padding: 8px 16px;
                  border: none;
                  border-radius: 4px;
                  cursor: pointer;
  
                  &:hover {
                    background: #0056b3;
                  }
                \`}>Click me</button>
              </div>
            </div>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const container = page.locator('div').nth(1);
    await expect(container).toHaveCSS('background-color', 'rgb(240, 240, 240)');
    await expect(container).toHaveCSS('padding', '20px');
    await expect(container).toHaveCSS('border-radius', '8px');

    await expect(page.locator('h1')).toHaveCSS('color', 'rgb(51, 51, 51)');
    await expect(page.locator('p')).toHaveCSS('color', 'rgb(102, 102, 102)');

    const button = page.locator('button');
    await expect(button).toHaveCSS('background-color', 'rgb(0, 123, 255)');
    await button.hover();
    await expect(button).toHaveCSS('background-color', 'rgb(0, 86, 179)');
  });

  test('should handle css prop with styled components', async ({ page }) => {
    await using env = await startEnv('css-prop-styled', {
      'App.tsx': dedent`
        import { styled } from "vindur";

        const BaseButton = styled.button\`
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
        \`;

        export default function App() {
          return (
            <div>
              <BaseButton css={\`
                background: #28a745;
                color: white;

                &:hover {
                  background: #218838;
                }
              \`}>Success</BaseButton>
      
              <BaseButton css={\`
                background: #dc3545;
                color: white;

                &:hover {
                  background: #c82333;
                }
              \`}>Danger</BaseButton>
            </div>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const successButton = page.locator('button').first();
    await expect(successButton).toHaveCSS(
      'background-color',
      'rgb(40, 167, 69)',
    );
    await expect(successButton).toHaveCSS('padding', '8px 16px');

    const dangerButton = page.locator('button').nth(1);
    await expect(dangerButton).toHaveCSS(
      'background-color',
      'rgb(220, 53, 69)',
    );
    await dangerButton.hover();
    await expect(dangerButton).toHaveCSS(
      'background-color',
      'rgb(200, 35, 51)',
    );
  });

  test('should merge css prop with existing className', async ({ page }) => {
    await using env = await startEnv('css-prop-merge', {
      'App.tsx': dedent`
        import { css } from "vindur";

        const baseClass = css\`
          padding: 10px;
          font-size: 16px;
        \`;

        export default function App() {
          return (
            <div>
              <div 
                className={baseClass}
                css={\`
                  background: #e3f2fd;
                  color: #1976d2;
                  border: 1px solid #90caf9;
                  border-radius: 4px;
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

    const element = page.locator('div').nth(1);
    await expect(element).toHaveCSS('padding', '10px');
    await expect(element).toHaveCSS('font-size', '16px');
    await expect(element).toHaveCSS('background-color', 'rgb(227, 242, 253)');
    await expect(element).toHaveCSS('color', 'rgb(25, 118, 210)');
    await expect(element).toHaveCSS('border', '1px solid rgb(144, 202, 249)');
  });
});
