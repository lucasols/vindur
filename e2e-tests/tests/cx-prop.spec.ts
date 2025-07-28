import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe('cx prop', () => {
  test.describe.configure({ mode: 'serial' });

  let env: TestEnv;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    env = await startEnv('cx-prop-tests', {
      'App.tsx': dedent`
        import { styled, css } from "vindur";

        const Button = styled.button\`
          padding: 8px 16px;

          &.active {
            background: #007bff;
          }

          &.large {
            font-size: 20px;
          }
        \`;

        const baseStyles = css\`
          padding: 10px;

          &.highlighted {
            background: #f0f8ff;
          }

          &.bold {
            font-weight: bold;
          }
        \`;

        export default function App() {
          return (
            <div>
              <Button 
                data-testid="conditional-button"
                cx={{
                  active: true,
                  large: true,
                }}
              >
                Active Large Button
              </Button>
      
              <Button 
                data-testid="unhashed-button"
                cx={{
                  active: false,
                  $external: true,
                }}
              >
                External Class Button
              </Button>

              <Button 
                data-testid="merged-button"
                className="existing"
                cx={{ active: true, $custom: true }}
              >
                Merged Classes
              </Button>

              <div 
                data-testid="css-function-element"
                className={baseStyles}
                cx={{
                  highlighted: true,
                  bold: true,
                }}
              >
                CSS Function with CX
              </div>

              <div 
                data-testid="css-function-mixed"
                className={baseStyles}
                cx={{
                  highlighted: false,
                  $utility: true,
                }}
              >
                CSS Function Mixed
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

  test('should apply conditional classes', async () => {
    const button = page.getByTestId('conditional-button');
    await expect(button).toHaveCSS('background-color', 'rgb(0, 123, 255)');
    await expect(button).toHaveCSS('font-size', '20px');
  });

  test('should handle unhashed classes with $ prefix', async () => {
    const button = page.getByTestId('unhashed-button');
    await expect(button).toHaveClass(/external/);
    await expect(button).not.toHaveCSS('background-color', 'rgb(0, 123, 255)');
  });

  test('should merge with existing className', async () => {
    const button = page.getByTestId('merged-button');
    await expect(button).toHaveClass(/existing/);
    await expect(button).toHaveClass(/custom/);
    await expect(button).toHaveCSS('background-color', 'rgb(0, 123, 255)');
  });

  test('should work with css function', async () => {
    const element = page.getByTestId('css-function-element');
    await expect(element).toHaveCSS('padding', '10px');
    await expect(element).toHaveCSS('background-color', 'rgb(240, 248, 255)');
    await expect(element).toHaveCSS('font-weight', '700');
  });

  test('should handle css function with mixed classes', async () => {
    const element = page.getByTestId('css-function-mixed');
    await expect(element).toHaveCSS('padding', '10px');
    await expect(element).toHaveClass(/utility/);
    await expect(element).not.toHaveCSS(
      'background-color',
      'rgb(240, 248, 255)',
    );
  });
});
