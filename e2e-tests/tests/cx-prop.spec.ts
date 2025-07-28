import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from '@playwright/test';
import { startEnv } from '../utils/startEnv';

test.describe('cx prop', () => {
  test('should handle conditional classes with cx prop', async ({ page }) => {
    await using env = await startEnv('cx-prop-conditional', {
      'App.tsx': dedent`
        import { css } from "vindur";

        const activeClass = css\`
          background: #007bff;
          color: white;
        \`;

        const disabledClass = css\`
          opacity: 0.5;
          cursor: not-allowed;
        \`;

        const largeClass = css\`
          font-size: 20px;
          padding: 12px 24px;
        \`;

        export default function App() {
          const isActive = true;
          const isDisabled = false;
          const isLarge = true;

          return (
            <div>
              <button cx={{
                [activeClass]: isActive,
                [disabledClass]: isDisabled,
                [largeClass]: isLarge,
              }}>
                Conditional Button
              </button>
      
              <button cx={{
                [activeClass]: !isActive,
                [disabledClass]: !isDisabled,
                [largeClass]: false,
              }}>
                Inverted Button
              </button>
            </div>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const firstButton = page.locator('button').first();
    await expect(firstButton).toHaveCSS('background-color', 'rgb(0, 123, 255)');
    await expect(firstButton).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(firstButton).toHaveCSS('font-size', '20px');
    await expect(firstButton).toHaveCSS('padding', '12px 24px');

    const secondButton = page.locator('button').nth(1);
    await expect(secondButton).toHaveCSS('opacity', '0.5');
    await expect(secondButton).toHaveCSS('cursor', 'not-allowed');
    await expect(secondButton).not.toHaveCSS(
      'background-color',
      'rgb(0, 123, 255)',
    );
  });

  test('should handle cx prop with unhashed classes', async ({ page }) => {
    await using env = await startEnv('cx-prop-unhashed', {
      'App.tsx': dedent`
        import { css } from "vindur";

        const primaryClass = css\`
          background: #007bff;
          color: white;
          padding: 8px 16px;
        \`;

        export default function App() {
          return (
            <div>
              <div cx={{
                [primaryClass]: true,
                $container: true,
                $flexbox: true,
                $hidden: false,
              }}>
                With external classes
              </div>
      
              <div 
                className="existing-class"
                cx={{
                  [primaryClass]: true,
                  $additionalClass: true,
                }}
              >
                Merged with className
              </div>
            </div>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const firstDiv = page.locator('div').nth(1);
    await expect(firstDiv).toHaveClass(/container/);
    await expect(firstDiv).toHaveClass(/flexbox/);
    await expect(firstDiv).not.toHaveClass(/hidden/);
    await expect(firstDiv).toHaveCSS('background-color', 'rgb(0, 123, 255)');

    const secondDiv = page.locator('div').nth(2);
    await expect(secondDiv).toHaveClass(/existing-class/);
    await expect(secondDiv).toHaveClass(/additionalClass/);
    await expect(secondDiv).toHaveCSS('background-color', 'rgb(0, 123, 255)');
  });

  test('should handle cx prop on styled components', async ({ page }) => {
    await using env = await startEnv('cx-prop-styled', {
      'App.tsx': dedent`
        import { css, styled } from "vindur";

        const Button = styled.button\`
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
        \`;

        const primaryVariant = css\`
          background: #007bff;
          color: white;
  
          &:hover {
            background: #0056b3;
          }
        \`;

        const outlineVariant = css\`
          background: transparent;
          color: #007bff;
          border: 2px solid #007bff;
  
          &:hover {
            background: #007bff;
            color: white;
          }
        \`;

        export default function App() {
          return (
            <div>
              <Button cx={{ [primaryVariant]: true }}>
                Primary
              </Button>
      
              <Button cx={{ [outlineVariant]: true }}>
                Outline
              </Button>
      
              <Button cx={{ 
                [primaryVariant]: false,
                [outlineVariant]: false,
                $defaultButton: true 
              }}>
                Default
              </Button>
            </div>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const primaryButton = page.locator('button').first();
    await expect(primaryButton).toHaveCSS(
      'background-color',
      'rgb(0, 123, 255)',
    );
    await expect(primaryButton).toHaveCSS('color', 'rgb(255, 255, 255)');

    const outlineButton = page.locator('button').nth(1);
    await expect(outlineButton).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    await expect(outlineButton).toHaveCSS('color', 'rgb(0, 123, 255)');
    await expect(outlineButton).toHaveCSS(
      'border',
      '2px solid rgb(0, 123, 255)',
    );

    const defaultButton = page.locator('button').nth(2);
    await expect(defaultButton).toHaveClass(/defaultButton/);
  });
});
