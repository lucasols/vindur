import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from '@playwright/test';
import { startEnv } from '../utils/startEnv';

// This test must fail when the soft-invalidation bug is present in the plugin.
// We assert that no HMR/transform errors are emitted by Vite on quick successive
// CSS updates. If the plugin incorrectly soft-invalidates, Vite emits errors like:
// "Soft-invalidated module ... should not have existing transform result".
test('should not produce soft-invalidation errors on rapid CSS updates', async ({
  page,
}) => {
  const browserLogs: string[] = [];
  const browserErrors: string[] = [];

  const errorPattern =
    /(should not have existing transform result|Soft-invalidated module|Pre-transform error|Internal server error)/i;

  page.on('console', (msg) => {
    const text = msg.text();
    browserLogs.push(text);
    if (errorPattern.test(text)) browserErrors.push(text);
  });
  page.on('pageerror', (err) => {
    const text = err.message;
    browserLogs.push(text);
    if (errorPattern.test(text)) browserErrors.push(text);
  });

  await using env = await startEnv('reproduce-bug', {
    'App.tsx': dedent`
      import { css } from "vindur";
      import OtherComponent from "#src/OtherComponent";

      const styles = css\`
        background: red;
        color: white;
      \`;

      export default function App() {
        return (
          <>
            <div data-testid="box" className={styles}>Test</div>
            <OtherComponent />
          </>
        );
      }
    `,
    'OtherComponent.tsx': dedent`
      import { css } from "vindur";
      const otherStyles = css\`
        background: blue;
        height: 50px;
      \`;
      export default function OtherComponent() {
        return <div data-testid="other" className={otherStyles}>Other</div>;
      }
    `,
  });

  await page.goto(env.baseUrl);
  const box = page.getByTestId('box');
  const other = page.getByTestId('other');
  await expect(box).toBeVisible({ timeout: 10000 });
  await expect(other).toBeVisible({ timeout: 10000 });

  // Clear any server-side logs accumulated during initial load
  env.serverLogs.length = 0;

  // Perform two rapid updates to maximize chance of overlapping transforms/HMR
  env.getFile('App.tsx').replace('background: red;', 'background: green;');
  // Very short delay so file watcher registers distinct mtime updates
  await page.waitForTimeout(20);
  env
    .getFile('OtherComponent.tsx')
    .replace('background: blue;', 'background: yellow;');

  // Wait for HMR to settle and styles to reflect latest changes
  await expect(box).toHaveCSS('background-color', 'rgb(0, 128, 0)'); // green
  await expect(other).toHaveCSS('background-color', 'rgb(255, 255, 0)'); // yellow

  // Collect matching errors from both server and browser logs
  const serverMatches = env.serverLogs.filter((l) => errorPattern.test(l));
  const browserMatches = browserErrors.filter((l) => errorPattern.test(l));

  // The correct behavior is: no soft-invalidation/transform errors at all.
  // If the bug exists, one of these assertions will fail and surface the issue.
  expect(
    serverMatches,
    `Server errors:\n${serverMatches.join('\n')}`,
  ).toHaveLength(0);
  expect(
    browserMatches,
    `Browser errors:\n${browserMatches.join('\n')}`,
  ).toHaveLength(0);
});
