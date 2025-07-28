import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('vindur-fn-tests', {
    'utils.ts': dedent`
      import { vindurFn } from "vindur";

      export const spacing = vindurFn((size: number) => \`
        padding: \${size}px;
        margin: \${size}px;
      \`);

      export const flexCenter = vindurFn(() => \`
        display: flex;
        align-items: center;
      \`);

      export const textStyle = vindurFn((size: number, color: string) => \`
        font-size: \${size}px;
        color: \${color};
      \`);
    `,
    'mixins.ts': dedent`
      import { vindurFn } from "vindur";

      export const buttonBase = vindurFn(() => \`
        padding: 8px 16px;
        border: none;
      \`);

      export const buttonVariant = vindurFn((bg: string) => \`
        background: \${bg};
  
        &:hover {
          opacity: 0.8;
        }
      \`);
    `,
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
      import { css, styled } from "vindur";
      import { spacing, flexCenter, textStyle } from "#src/utils";
      import { buttonBase, buttonVariant } from "#src/mixins";
      import { responsive, grid } from "#src/theme";

      const containerClass = css\`
        \${spacing(20)}
        \${flexCenter()}
        background: #f0f0f0;
      \`;

      const textClass = css\`
        \${textStyle(24, "#333")}
        font-weight: bold;
      \`;

      const PrimaryButton = styled.button\`
        \${buttonBase()}
        \${buttonVariant("#007bff")}
      \`;

      const SecondaryButton = styled.button\`
        \${buttonBase()}
        \${buttonVariant("#6c757d")}
      \`;

      const gridClass = css\`
        \${grid(3, 20)}
        padding: 20px;
      \`;

      const headingClass = css\`
        \${responsive("18px", "24px", "32px")}
        font-weight: bold;
      \`;

      export default function App() {
        return (
          <div>
            <div data-testid="container" className={containerClass}>
              <p data-testid="text" className={textClass}>Styled with vindurFn</p>
            </div>

            <div>
              <PrimaryButton data-testid="primary-button">Primary</PrimaryButton>
              <SecondaryButton data-testid="secondary-button">Secondary</SecondaryButton>
            </div>

            <h1 data-testid="responsive-heading" className={headingClass}>Responsive Heading</h1>
            <div data-testid="grid-container" className={gridClass}>
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
});

test.afterAll(async () => {
  await page.close();
  await env.cleanup();
});

test('should handle vindurFn utilities', async () => {
  const container = page.getByTestId('container');
  await expect(container).toHaveCSS('padding', '20px');
  await expect(container).toHaveCSS('margin', '20px');
  await expect(container).toHaveCSS('display', 'flex');
  await expect(container).toHaveCSS('align-items', 'center');
  await expect(container).toHaveCSS('background-color', 'rgb(240, 240, 240)');

  const text = page.getByTestId('text');
  await expect(text).toHaveCSS('font-size', '24px');
  await expect(text).toHaveCSS('color', 'rgb(51, 51, 51)');
  await expect(text).toHaveCSS('font-weight', '700');
});

test('should handle vindurFn with styled components', async () => {
  const primaryButton = page.getByTestId('primary-button');
  await expect(primaryButton).toHaveCSS('background-color', 'rgb(0, 123, 255)');
  await expect(primaryButton).toHaveCSS('padding', '8px 16px');

  const secondaryButton = page.getByTestId('secondary-button');
  await expect(secondaryButton).toHaveCSS(
    'background-color',
    'rgb(108, 117, 125)',
  );
});

test('should handle complex vindurFn compositions', async () => {
  const heading = page.getByTestId('responsive-heading');

  await page.setViewportSize({ width: 375, height: 667 });
  await expect(heading).toHaveCSS('font-size', '18px');

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(heading).toHaveCSS('font-size', '24px');

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(heading).toHaveCSS('font-size', '32px');

  const container = page.getByTestId('grid-container');
  await expect(container).toHaveCSS('display', 'grid');
  await expect(container).toHaveCSS('grid-template-columns', 'repeat(3, 1fr)');
  await expect(container).toHaveCSS('gap', '20px');
});
