import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe('css tagged template', () => {
  test.describe.configure({ mode: 'serial' });

  let env: TestEnv;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    env = await startEnv('css-tagged-template-tests', {
      'App.tsx': dedent`
        import { css } from "vindur";

        const headerClass = css\`
          color: red;
          font-size: 32px;
        \`;

        const buttonClass = css\`
          background: lightblue;
          padding: 10px 20px;
  
          &:hover {
            background: darkblue;
          }
        \`;

        const nestedClass = css\`
          color: blue;

          h2 {
            font-size: 24px;
          }

          .highlight {
            background: yellow;
          }
        \`;

        const mediaClass = css\`
          font-size: 14px;

          @media (min-width: 768px) {
            font-size: 18px;
          }
        \`;

        export default function App() {
          return (
            <div>
              <h1 data-testid="header" className={headerClass}>Title</h1>
              <button data-testid="button" className={buttonClass}>Click me</button>
      
              <div data-testid="nested" className={nestedClass}>
                <h2>Nested heading</h2>
                <span className="highlight">Highlighted text</span>
              </div>

              <p data-testid="media" className={mediaClass}>Responsive text</p>
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

  test('should handle basic styles and multiple declarations', async () => {
    const header = page.getByTestId('header');
    await expect(header).toHaveCSS('color', 'rgb(255, 0, 0)');
    await expect(header).toHaveCSS('font-size', '32px');
  });

  test('should handle pseudo-classes and hover states', async () => {
    const button = page.getByTestId('button');
    await expect(button).toHaveCSS('background-color', 'rgb(173, 216, 230)');
    await expect(button).toHaveCSS('padding', '10px 20px');

    await button.hover();
    await expect(button).toHaveCSS('background-color', 'rgb(0, 0, 139)');
  });

  test('should handle nested selectors', async () => {
    const nested = page.getByTestId('nested');
    await expect(nested).toHaveCSS('color', 'rgb(0, 0, 255)');

    const heading = nested.locator('h2');
    await expect(heading).toHaveCSS('font-size', '24px');

    const highlight = nested.locator('.highlight');
    await expect(highlight).toHaveCSS('background-color', 'rgb(255, 255, 0)');
  });

  test('should handle media queries', async () => {
    const media = page.getByTestId('media');
    await expect(media).toHaveCSS('font-size', '18px');
  });
});
