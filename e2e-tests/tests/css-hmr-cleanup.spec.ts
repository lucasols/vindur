import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from '@playwright/test';
import { startEnv } from '../utils/startEnv';

// Reproduces a bug where removed CSS properties linger after HMR.
// We start with border + letter-spacing, then remove them and assert
// they are no longer applied (computed styles reflect defaults).
test('should remove deleted CSS properties on HMR (no stale styles)', async ({
  page,
}) => {
  await using env = await startEnv('css-hmr-cleanup', {
    'App.tsx': dedent`
      import { css } from "vindur";

      const styles = css\`
        background: red;
        color: white;
        border: 4px solid rgb(1, 2, 3);
        letter-spacing: 3px;
      \`;

      export default function App() {
        return <div data-testid="box" className={styles}>Test</div>;
      }
    `,
  });

  await page.goto(env.baseUrl);
  const box = page.getByTestId('box');
  await expect(box).toBeVisible({ timeout: 10000 });

  // Ensure initial styles took effect
  await expect(box).toHaveCSS('letter-spacing', '3px');
  await expect(box).toHaveCSS('border-top-width', '4px');
  await expect(box).toHaveCSS('border-top-style', 'solid');

  // Clear any server logs since first load produces transforms/HMR noise
  env.serverLogs.length = 0;

  // Update to remove border and letter-spacing entirely
  env.getFile('App.tsx').replace('letter-spacing: 3px;', '');
  env.getFile('App.tsx').replace('border: 4px solid rgb(1, 2, 3);', '');

  // Wait for HMR to apply
  await expect(box).toHaveCSS('background-color', 'rgb(255, 0, 0)'); // still red

  // Expect removed properties to be reset to defaults
  const after = await box.evaluate((el) => {
    const cs = window.getComputedStyle(el);
    return {
      letterSpacing: cs.letterSpacing,
      borderTopWidth: cs.borderTopWidth,
      borderTopStyle: cs.borderTopStyle,
    };
  });

  expect(after.letterSpacing).toBe('normal');
  expect(after.borderTopWidth).toBe('0px');
  expect(after.borderTopStyle).toBe('none');
});
