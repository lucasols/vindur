import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('dynamic-colors-tests', {
    'App.tsx': dedent`
      import { styled, createDynamicCssColor } from "vindur";

      const primaryColor = createDynamicCssColor();
      const secondaryColor = createDynamicCssColor();

      const Button = styled.button\`
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        background: \${primaryColor.var};
        color: white;
        font-weight: 500;
      \`;

      const SecondaryButton = styled.button\`
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        background: \${secondaryColor.var};
        color: white;
        font-weight: 500;
      \`;

      const Card = styled.div\`
        padding: 20px;
        border-radius: 8px;
        margin: 10px;
        background: \${primaryColor.var};
      \`;

      export default function App() {
        return (
          <div>
            <Button 
              data-testid="primary-button"
              dynamicColor={primaryColor.set('#ff6b6b')}
            >
              Primary Button
            </Button>

            <SecondaryButton 
              data-testid="secondary-button"
              dynamicColor={secondaryColor.set('#4ecdc4')}
            >
              Secondary Button
            </SecondaryButton>

            <Card 
              data-testid="primary-card"
              dynamicColor={primaryColor.set('#95e1d3')}
            >
              Primary Card
            </Card>
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

test('should apply dynamic colors to styled components', async () => {
  const primaryButton = page.getByTestId('primary-button');
  const secondaryButton = page.getByTestId('secondary-button');

  await expect(primaryButton).toHaveCSS(
    'background-color',
    'rgb(255, 107, 107)',
  ); // #ff6b6b
  await expect(secondaryButton).toHaveCSS(
    'background-color',
    'rgb(78, 205, 196)',
  ); // #4ecdc4
});

test('should apply dynamic colors to different element types', async () => {
  const primaryCard = page.getByTestId('primary-card');

  await expect(primaryCard).toHaveCSS('background-color', 'rgb(149, 225, 211)'); // #95e1d3
});
