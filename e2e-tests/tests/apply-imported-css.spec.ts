import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from '@playwright/test';
import { startEnv, startEnvProd } from '../utils/startEnv';

test('should extend CSS styles imported from another file', async ({
  browser,
}) => {
  const pageDev = await browser.newPage();
  const envDev = await startEnv('css-import-extension-tests', {
    'styles.ts': dedent`
      import { css, vindurFn } from "vindur";

      export const baseStyles = css\`
        display: flex;
        align-items: center;
        background: white;
      \`;

      export const buttonStyles = vindurFn((color: string, size: number) => \`
        background-color: \${color};
        padding: \${size}px;
        border: none;
        cursor: pointer;
      \`);
    `,
    'App.tsx': dedent`
      import { css } from "vindur";
      import { baseStyles, buttonStyles } from "#src/styles";

      const styles = css\`
        \${baseStyles};
        padding: 12px 24px;
        border-radius: 4px;
        font-weight: 500;
      \`;

      const btnStyles = css\`
        \${buttonStyles('#3b82f6', 8)};
        border-radius: 6px;
        color: white;
      \`;

      export default function App() {
        return (
          <div>
            <div data-testid="extended" className={styles}>Hello</div>
            <button data-testid="button" className={btnStyles}>Click me</button>
          </div>
        );
      }
    `,
  });

  await pageDev.goto(envDev.baseUrl);

  const el = pageDev.getByTestId('extended');

  // Imported base styles
  await expect(el).toHaveCSS('display', 'flex');
  await expect(el).toHaveCSS('align-items', 'center');
  await expect(el).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  // Locally extended styles
  await expect(el).toHaveCSS('padding', '12px 24px');
  await expect(el).toHaveCSS('border-radius', '4px');
  await expect(el).toHaveCSS('font-weight', '500');

  // Test vindurFn import
  const btn = pageDev.getByTestId('button');
  await expect(btn).toHaveCSS('background-color', 'rgb(59, 130, 246)');
  await expect(btn).toHaveCSS('padding', '8px');
  await expect(btn).toHaveCSS('border-style', 'none');
  await expect(btn).toHaveCSS('cursor', 'pointer');
  await expect(btn).toHaveCSS('border-radius', '6px');
  await expect(btn).toHaveCSS('color', 'rgb(255, 255, 255)');

  await pageDev.close();
  await envDev.cleanup();
});

test('should extend CSS styles imported from another file (prod build)', async ({
  browser,
}) => {
  const pageProd = await browser.newPage();
  const envProd = await startEnvProd('css-import-extension-tests-prod', {
    'styles.ts': dedent`
      import { css, vindurFn } from "vindur";

      export const baseStyles = css\`
        display: flex;
        align-items: center;
        background: white;
      \`;

      export const buttonStyles = vindurFn((color: string, size: number) => \`
        background-color: \${color};
        padding: \${size}px;
        border: none;
        cursor: pointer;
      \`);
    `,
    'App.tsx': dedent`
      import { css } from "vindur";
      import { baseStyles, buttonStyles } from "#src/styles";

      const styles = css\`
        \${baseStyles};
        padding: 12px 24px;
        border-radius: 4px;
        font-weight: 500;
      \`;

      const btnStyles = css\`
        \${buttonStyles('#3b82f6', 8)};
        border-radius: 6px;
        color: white;
      \`;

      export default function App() {
        return (
          <div>
            <div data-testid="extended" className={styles}>Hello</div>
            <button data-testid="button" className={btnStyles}>Click me</button>
          </div>
        );
      }
    `,
  });

  await pageProd.goto(envProd.baseUrl);

  const el = pageProd.getByTestId('extended');
  await expect(el).toHaveCSS('display', 'flex');
  await expect(el).toHaveCSS('align-items', 'center');
  await expect(el).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(el).toHaveCSS('padding', '12px 24px');
  await expect(el).toHaveCSS('border-radius', '4px');
  await expect(el).toHaveCSS('font-weight', '500');

  // Test vindurFn import
  const btn = pageProd.getByTestId('button');
  await expect(btn).toHaveCSS('background-color', 'rgb(59, 130, 246)');
  await expect(btn).toHaveCSS('padding', '8px');
  await expect(btn).toHaveCSS('border-style', 'none');
  await expect(btn).toHaveCSS('cursor', 'pointer');
  await expect(btn).toHaveCSS('border-radius', '6px');
  await expect(btn).toHaveCSS('color', 'rgb(255, 255, 255)');

  await pageProd.close();
  await envProd.cleanup();
});
