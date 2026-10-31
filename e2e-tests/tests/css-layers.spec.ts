import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('css-layers-tests', {
    'layers.ts': dedent`
      import { createGlobalStyle } from "vindur";

      createGlobalStyle\`
        @layer lower-priority, higher-priority;
      \`;
    `,
    'Card.tsx': dedent`
      import { layer, styled } from "vindur";

      export const Card = styled.div\`
        \${layer('higher-priority')} {
          color: rgb(0, 0, 255);
        }

        \${layer('lower-priority')} {
          color: rgb(255, 0, 0);
        }
      \`;
    `,
    'App.tsx': dedent`
      import "#src/layers";
      import { Card } from "#src/Card";

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

test('should apply the layer order declared in a module imported first', async () => {
  await expect(page.getByTestId('card')).toHaveCSS('color', 'rgb(0, 0, 255)');
});
