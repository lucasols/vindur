import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('style-flags-tests', {
    'App.tsx': dedent`
      import { styled } from "vindur";

      const Button = styled.button<{ 
        variant: 'primary' | 'secondary' | 'danger';
        size: 'small' | 'large';
        disabled: boolean;
        loading: boolean;
      }>\`
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        font-weight: 500;

        &.variant-primary {
          background: #007bff;
          color: white;
        }

        &.variant-secondary {
          background: #6c757d;
          color: white;
        }

        &.variant-danger {
          background: #dc3545;
          color: white;
        }

        &.size-small {
          padding: 4px 8px;
          font-size: 12px;
        }

        &.size-large {
          padding: 12px 24px;
          font-size: 18px;
        }

        &.disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        &.loading {
          background: #f8f9fa;
          color: #6c757d;
        }
      \`;

      export default function App() {
        return (
          <div>
            <Button 
              data-testid="primary-button"
              variant="primary"
              size="large"
              disabled={false}
              loading={false}
            >
              Primary Large
            </Button>

            <Button 
              data-testid="disabled-button"
              variant="secondary"
              size="small"
              disabled={true}
              loading={false}
            >
              Disabled Small
            </Button>

            <Button 
              data-testid="loading-button"
              variant="danger"
              size="large"
              disabled={false}
              loading={true}
            >
              Loading
            </Button>
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

test('should apply string union style flags', async () => {
  const primaryButton = page.getByTestId('primary-button');

  await expect(primaryButton).toHaveClass(/variant-primary/);
  await expect(primaryButton).toHaveClass(/size-large/);
  await expect(primaryButton).toHaveCSS('background-color', 'rgb(0, 123, 255)'); // primary
  await expect(primaryButton).toHaveCSS('padding', '12px 24px'); // large
});

test('should apply boolean style flags', async () => {
  const disabledButton = page.getByTestId('disabled-button');

  await expect(disabledButton).toHaveClass(/disabled/);
  await expect(disabledButton).toHaveClass(/variant-secondary/);
  await expect(disabledButton).toHaveClass(/size-small/);
  await expect(disabledButton).toHaveCSS('opacity', '0.6');
});

test('should handle multiple flags together', async () => {
  const loadingButton = page.getByTestId('loading-button');

  await expect(loadingButton).toHaveClass(/loading/);
  await expect(loadingButton).toHaveClass(/variant-danger/);
  await expect(loadingButton).toHaveClass(/size-large/);
  await expect(loadingButton).toHaveCSS(
    'background-color',
    'rgb(248, 249, 250)',
  ); // loading overrides danger
});
