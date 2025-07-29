import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('stable-id-tests', {
    'App.tsx': dedent`
      import { css, stableId } from "vindur";

      const modalId = stableId();
      const headerId = stableId();
      const footerId = stableId();

      const layoutStyles = css\`
        #\${modalId} {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        #\${headerId} {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 16px;
          color: #333;
        }

        #\${footerId} {
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid #eee;
          text-align: right;
        }
      \`;

      export default function App() {
        return (
          <div className={layoutStyles}>
            <div id={modalId} data-testid="modal">
              <h2 id={headerId} data-testid="header">
                Modal Header
              </h2>
              <p>Modal content goes here.</p>
              <div id={footerId} data-testid="footer">
                <button>Close</button>
              </div>
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

test('should generate stable IDs for CSS targeting', async () => {
  const modal = page.getByTestId('modal');
  const header = page.getByTestId('header');
  const footer = page.getByTestId('footer');
  
  // Check that elements have IDs
  const modalId = await modal.getAttribute('id');
  const headerId = await header.getAttribute('id');
  const footerId = await footer.getAttribute('id');
  
  expect(modalId).toBeTruthy();
  expect(headerId).toBeTruthy();
  expect(footerId).toBeTruthy();
  
  // IDs should be different
  expect(modalId).not.toBe(headerId);
  expect(headerId).not.toBe(footerId);
});

test('should apply CSS styles using stable IDs', async () => {
  const modal = page.getByTestId('modal');
  const header = page.getByTestId('header');
  const footer = page.getByTestId('footer');
  
  await expect(modal).toHaveCSS('position', 'fixed');
  await expect(modal).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(modal).toHaveCSS('padding', '20px');
  
  await expect(header).toHaveCSS('font-size', '24px');
  await expect(header).toHaveCSS('font-weight', '700');
  
  await expect(footer).toHaveCSS('text-align', 'right');
  await expect(footer).toHaveCSS('border-top-width', '1px');
});

test('should maintain ID consistency', async () => {
  const modal = page.getByTestId('modal');
  const modalId = await modal.getAttribute('id');
  
  // Refresh page and check ID remains the same (deterministic)
  await page.reload();
  
  const modalAfterReload = page.getByTestId('modal');
  const modalIdAfterReload = await modalAfterReload.getAttribute('id');
  
  expect(modalIdAfterReload).toBe(modalId);
});