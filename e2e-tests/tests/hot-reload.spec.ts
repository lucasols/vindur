import { dedent } from '@ls-stack/utils/dedent';
import { sleep } from '@ls-stack/utils/sleep';
import { expect, test } from '@playwright/test';
import { startEnv } from '../utils/startEnv';

test('should update styles when the file itself changes', async ({ page }) => {
  await using env = await startEnv('hot-reload-self', {
    'App.tsx': dedent`
      import { css } from "vindur";

      const titleClass = css\`
        color: red;
      \`;

      export default function App() {
        return <h1 data-testid="title" className={titleClass}>Self Hot Reload</h1>;
      }
    `,
  });

  await page.goto(env.baseUrl);

  // Debug: Check if page loads and has content
  await page.waitForLoadState('networkidle');

  const title = page.getByTestId('title');

  // Wait for the element to exist before checking CSS
  await expect(title).toBeVisible({ timeout: 10000 });
  await expect(title).toHaveCSS('color', 'rgb(255, 0, 0)'); // red

  // Update styles using multiple replacements at once
  env.getFile('App.tsx').replace([
    ['color: red;', 'color: blue;'],
    ['Self Hot Reload', 'Self Hot Reload Updated'],
  ]);

  // Wait for hot reload and check updated styles
  await expect(title).toHaveCSS('color', 'rgb(0, 0, 255)'); // blue
  await expect(title).toHaveText('Self Hot Reload Updated');

  // Do a second update on style only
  env.getFile('App.tsx').replace([['color: blue;', 'color: green;']]);

  await expect(title).toHaveCSS('color', 'rgb(0, 128, 0)'); // green

  // do sequential updates
  env.getFile('App.tsx').replace([['color: green;', 'color: #000;']]);
  await sleep(20);
  env.getFile('App.tsx').replace([['color: #000;', 'color: #fff;']]);

  await expect(title).toHaveCSS('color', 'rgb(255, 255, 255)'); // white

  // revert to a previous state
  env.getFile('App.tsx').replace([['color: #fff;', 'color: blue;']]);

  await expect(title).toHaveCSS('color', 'rgb(0, 0, 255)'); // blue

  // perform a non style update
  env
    .getFile('App.tsx')
    .replace([['Self Hot Reload Updated', 'Self Hot Reload 2']]);
  await expect(title).toHaveText('Self Hot Reload 2');
});

test('should update styled components when the file changes', async ({
  page,
}) => {
  await using env = await startEnv('hot-reload-styled', {
    'App.tsx': dedent`
      import { styled } from "vindur";

      const Button = styled.button\`
        background: green;
        color: white;
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
      \`;

      const Container = styled.div\`
        padding: 20px;
        background: #f0f0f0;
      \`;

      export default function App() {
        return (
          <Container data-testid="container">
            <Button data-testid="button">Click me</Button>
          </Container>
        );
      }
    `,
  });

  await page.goto(env.baseUrl);

  const container = page.getByTestId('container');
  const button = page.getByTestId('button');

  await expect(container).toHaveCSS('padding', '20px');
  await expect(container).toHaveCSS('background-color', 'rgb(240, 240, 240)');
  await expect(button).toHaveCSS('background-color', 'rgb(0, 128, 0)'); // green
  await expect(button).toHaveCSS('padding', '10px 20px');

  // Update only button background color
  env.getFile('App.tsx').replace('background: green;', 'background: purple;');

  // Wait for hot reload and check updated styles
  await expect(button).toHaveCSS('background-color', 'rgb(128, 0, 128)'); // purple

  // perform a second update
  env.getFile('App.tsx').replace('background: purple;', 'background: blue;');
  await expect(button).toHaveCSS('background-color', 'rgb(0, 0, 255)'); // blue

  // perform a update back to green
  env.getFile('App.tsx').replace('background: blue;', 'background: green;');
  await expect(button).toHaveCSS('background-color', 'rgb(0, 128, 0)'); // green
});

test('should update styles when imported vindurFn changes', async ({
  page,
}) => {
  await using env = await startEnv('vindur-fn-hot-change', {
    'constants.ts': dedent`
      import { vindurFn } from "vindur";

      export const titleStyles = vindurFn((color: string, size: number) => \`
        color: \${color};
        font-size: \${size * 1}px;
      \`);
    `,
    'App.tsx': dedent`
      import { css } from "vindur";
      import { titleStyles } from "#src/constants";

      const titleClass = css\`
        \${titleStyles('red', 16)}
      \`;

      export default function App() {
        return <h1 data-testid="title" className={titleClass}>Hot Reload Test</h1>;
      }
    `,
  });

  await page.goto(env.baseUrl);

  const title = page.getByTestId('title');
  await expect(title).toHaveCSS('color', 'rgb(255, 0, 0)'); // red
  await expect(title).toHaveCSS('font-size', '16px');

  // Update constants to add font-weight
  env
    .getFile('constants.ts')
    .replace('font-size: ${size * 1}px;', 'font-size: ${size * 2}px;');

  // Wait for hot reload and check updated styles
  await expect(title).toHaveCSS('font-size', '32px');

  // perform a second update
  env
    .getFile('constants.ts')
    .replace('font-size: ${size * 2}px;', 'font-size: ${size * 3}px;');

  await expect(title).toHaveCSS('font-size', '48px');

  // perform a third update back to original
  env
    .getFile('constants.ts')
    .replace('font-size: ${size * 3}px;', 'font-size: ${size * 1}px;');

  await expect(title).toHaveCSS('font-size', '16px');
});
