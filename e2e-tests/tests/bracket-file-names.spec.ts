import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('bracket-file-names', {
    'pages/card[id].tsx': dedent`
      import { styled } from 'vindur';

      export const Card = styled.div\`
        display: grid;
        color: rgb(255, 0, 0);
      \`;
    `,
    'App.tsx': dedent`
      import { Card } from '#src/pages/card[id]';

      export default function App() {
        return <Card data-testid="card">Card</Card>;
      }
    `,
  });
  await page.goto(env.baseUrl);
});

test.afterAll(async () => {
  await page.close();
  await env.cleanup();
});

test('should load the styles of files with brackets in their name', async () => {
  const card = page.getByTestId('card');
  await expect(card).toHaveCSS('display', 'grid');
  await expect(card).toHaveCSS('color', 'rgb(255, 0, 0)');
});

test('should hot reload the styles of files with brackets in their name', async () => {
  env
    .getFile('pages/card[id].tsx')
    .replace('color: rgb(255, 0, 0);', 'color: rgb(0, 0, 255);');

  await expect(page.getByTestId('card')).toHaveCSS('color', 'rgb(0, 0, 255)');
});
