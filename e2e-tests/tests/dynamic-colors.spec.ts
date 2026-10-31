import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('dynamic-colors-tests', {
    'colors.ts': dedent`
      import { createDynamicCssColor } from "vindur";

      export const accentColor = createDynamicCssColor();
    `,
    // Only uses the dynamicColor prop, without importing vindur
    'AccentSwatch.tsx': dedent`
      import type { ReactNode } from "react";
      import { accentColor } from "#src/colors";

      export function AccentSwatch({ children }: { children: ReactNode }) {
        return <div dynamicColor={accentColor.set('#123456')}>{children}</div>;
      }
    `,
    'App.tsx': dedent`
      import { styled, createDynamicCssColor } from "vindur";
      import { accentColor } from "#src/colors";
      import { AccentSwatch } from "#src/AccentSwatch";

      const primaryColor = createDynamicCssColor();
      const secondaryColor = createDynamicCssColor();

      const Button = styled.button\`
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        background: \${primaryColor.value};
        color: white;
        font-weight: 500;
      \`;

      const SecondaryButton = styled.button\`
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        background: \${secondaryColor.value};
        color: white;
        font-weight: 500;
      \`;

      const Card = styled.div\`
        padding: 20px;
        border-radius: 8px;
        margin: 10px;
        background: \${primaryColor.value};
      \`;

      const AccentFill = styled.div\`
        height: 10px;
        background: \${accentColor.value};
      \`;

      export default function App() {
        return (
          <div>
            <AccentSwatch>
              <AccentFill data-testid="accent-fill" />
            </AccentSwatch>

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

test('should transform the dynamicColor prop in files that only import a color', async () => {
  await expect(page.getByTestId('accent-fill')).toHaveCSS(
    'background-color',
    'rgb(18, 52, 86)',
  ); // #123456
});
