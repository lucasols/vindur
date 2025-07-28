import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from '@playwright/test';
import { startEnv } from '../utils/startEnv';

test.describe('vindurFn', () => {
  test('should handle vindurFn utilities', async ({ page }) => {
    await using env = await startEnv('vindur-fn-basic', {
      'utils.ts': dedent`
        import { vindurFn } from "vindur";

        export const spacing = vindurFn((size: number) => \`
          padding: \${size}px;
          margin: \${size}px;
        \`);

        export const flexCenter = vindurFn(() => \`
          display: flex;
          align-items: center;
          justify-content: center;
        \`);

        export const textStyle = vindurFn((size: number, color: string) => \`
          font-size: \${size}px;
          color: \${color};
          line-height: 1.5;
        \`);
      `,
      'App.tsx': dedent`
        import { css } from "vindur";
        import { spacing, flexCenter, textStyle } from "#src/utils";

        const containerClass = css\`
          \${spacing(20)}
          \${flexCenter()}
          background: #f0f0f0;
          min-height: 200px;
        \`;

        const textClass = css\`
          \${textStyle(24, "#333")}
          font-weight: bold;
        \`;

        export default function App() {
          return (
            <div className={containerClass}>
              <p className={textClass}>Styled with vindurFn</p>
            </div>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const container = page.locator('div').first();
    await expect(container).toHaveCSS('padding', '20px');
    await expect(container).toHaveCSS('margin', '20px');
    await expect(container).toHaveCSS('display', 'flex');
    await expect(container).toHaveCSS('align-items', 'center');
    await expect(container).toHaveCSS('justify-content', 'center');
    await expect(container).toHaveCSS('background-color', 'rgb(240, 240, 240)');

    const text = page.locator('p');
    await expect(text).toHaveCSS('font-size', '24px');
    await expect(text).toHaveCSS('color', 'rgb(51, 51, 51)');
    await expect(text).toHaveCSS('line-height', '1.5');
    await expect(text).toHaveCSS('font-weight', '700');
  });

  test('should handle vindurFn with styled components', async ({ page }) => {
    await using env = await startEnv('vindur-fn-styled', {
      'mixins.ts': dedent`
        import { vindurFn } from "vindur";

        export const buttonBase = vindurFn(() => \`
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
          transition: all 0.2s;
        \`);

        export const buttonVariant = vindurFn((bg: string, color: string) => \`
          background: \${bg};
          color: \${color};
  
          &:hover {
            opacity: 0.8;
          }
  
          &:active {
            transform: scale(0.95);
          }
        \`);
      `,
      'App.tsx': dedent`
        import { styled } from "vindur";
        import { buttonBase, buttonVariant } from "#src/mixins";

        const PrimaryButton = styled.button\`
          \${buttonBase()}
          \${buttonVariant("#007bff", "white")}
        \`;

        const SecondaryButton = styled.button\`
          \${buttonBase()}
          \${buttonVariant("#6c757d", "white")}
        \`;

        export default function App() {
          return (
            <div>
              <PrimaryButton>Primary</PrimaryButton>
              <SecondaryButton>Secondary</SecondaryButton>
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
    await expect(primaryButton).toHaveCSS('padding', '8px 16px');
    await expect(primaryButton).toHaveCSS('border-radius', '4px');

    const secondaryButton = page.locator('button').nth(1);
    await expect(secondaryButton).toHaveCSS(
      'background-color',
      'rgb(108, 117, 125)',
    );
    await expect(secondaryButton).toHaveCSS('transition', 'all 0.2s');
  });

  test('should handle complex vindurFn compositions', async ({ page }) => {
    await using env = await startEnv('vindur-fn-complex', {
      'theme.ts': dedent`
        import { vindurFn } from "vindur";

        export const responsive = vindurFn((mobile: string, tablet: string, desktop: string) => \`
          font-size: \${mobile};
  
          @media (min-width: 768px) {
            font-size: \${tablet};
          }
  
          @media (min-width: 1024px) {
            font-size: \${desktop};
          }
        \`);

        export const grid = vindurFn((columns: number, gap: number) => \`
          display: grid;
          grid-template-columns: repeat(\${columns}, 1fr);
          gap: \${gap}px;
        \`);
      `,
      'App.tsx': dedent`
        import { css } from "vindur";
        import { responsive, grid } from "#src/theme";

        const containerClass = css\`
          \${grid(3, 20)}
          padding: 20px;
        \`;

        const headingClass = css\`
          \${responsive("18px", "24px", "32px")}
          font-weight: bold;
          margin-bottom: 10px;
        \`;

        export default function App() {
          return (
            <div>
              <h1 className={headingClass}>Responsive Heading</h1>
              <div className={containerClass}>
                <div>Item 1</div>
                <div>Item 2</div>
                <div>Item 3</div>
              </div>
            </div>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const heading = page.locator('h1');

    await page.setViewportSize({ width: 375, height: 667 });
    await expect(heading).toHaveCSS('font-size', '18px');

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(heading).toHaveCSS('font-size', '24px');

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(heading).toHaveCSS('font-size', '32px');

    const container = page.locator('div').nth(1);
    await expect(container).toHaveCSS('display', 'grid');
    await expect(container).toHaveCSS(
      'grid-template-columns',
      'repeat(3, 1fr)',
    );
    await expect(container).toHaveCSS('gap', '20px');
  });
});
