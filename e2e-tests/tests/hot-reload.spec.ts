import { test, expect } from '@playwright/test';
import { dedent } from '@ls-stack/utils/dedent';
import { startEnv } from '../utils/startEnv';

test.describe('hot reload behavior', () => {
  test('should update styles when the file itself changes', async ({ page }) => {
    await using env = await startEnv('hot-reload-self', {
      'App.tsx': dedent`
        import { css } from "vindur";

        const titleClass = css\`
          color: red;
          font-size: 24px;
          font-weight: bold;
        \`;

        export default function App() {
          return <h1 className={titleClass}>Self Hot Reload</h1>;
        }
      `,
    });

    // Listen for console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('Browser console error:', msg.text());
      }
    });
    
    page.on('pageerror', error => {
      console.log('Page error:', error.message);
    });

    await page.goto(env.baseUrl);
    
    // Debug: Check if page loads and has content
    await page.waitForLoadState('networkidle');
    const pageContent = await page.content();
    console.log('Page HTML preview:', pageContent.substring(0, 500));
    
    const title = page.locator('h1');
    
    // Wait for the element to exist before checking CSS
    await expect(title).toBeVisible({ timeout: 10000 });
    await expect(title).toHaveCSS('color', 'rgb(255, 0, 0)'); // red
    await expect(title).toHaveCSS('font-size', '24px');
    await expect(title).toHaveCSS('font-weight', '700'); // bold

    // Update the same file
    env.getFile('App.tsx').write(dedent`
      import { css } from "vindur";

      const titleClass = css\`
        color: blue;
        font-size: 32px;
        font-weight: normal;
        text-decoration: underline;
      \`;

      export default function App() {
        return <h1 className={titleClass}>Self Hot Reload Updated</h1>;
      }
    `);

    // Wait for hot reload and check updated styles
    await expect(title).toHaveCSS('color', 'rgb(0, 0, 255)', { timeout: 3000 }); // blue
    await expect(title).toHaveCSS('font-size', '32px');
    await expect(title).toHaveCSS('font-weight', '400'); // normal
    await expect(title).toHaveCSS('text-decoration-line', 'underline');
    await expect(title).toHaveText('Self Hot Reload Updated');
  });

  test('should update styled components when the file changes', async ({ page }) => {
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
            <Container>
              <Button>Click me</Button>
            </Container>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const container = page.locator('div').first();
    const button = page.locator('button');
    
    await expect(container).toHaveCSS('padding', '20px');
    await expect(container).toHaveCSS('background-color', 'rgb(240, 240, 240)');
    await expect(button).toHaveCSS('background-color', 'rgb(0, 128, 0)'); // green
    await expect(button).toHaveCSS('padding', '10px 20px');

    // Update styled components
    env.getFile('App.tsx').write(dedent`
      import { styled } from "vindur";

      const Button = styled.button\`
        background: purple;
        color: yellow;
        padding: 15px 30px;
        border: 2px solid black;
        border-radius: 8px;
      \`;

      const Container = styled.div\`
        padding: 40px;
        background: #e8e8e8;
        margin: 10px;
      \`;

      export default function App() {
        return (
          <Container>
            <Button>Updated Button</Button>
          </Container>
        );
      }
    `);

    // Wait for hot reload and check updated styles
    await expect(container).toHaveCSS('padding', '40px', { timeout: 3000 });
    await expect(container).toHaveCSS('background-color', 'rgb(232, 232, 232)');
    await expect(container).toHaveCSS('margin', '10px');
    await expect(button).toHaveCSS('background-color', 'rgb(128, 0, 128)'); // purple
    await expect(button).toHaveCSS('color', 'rgb(255, 255, 0)'); // yellow
    await expect(button).toHaveCSS('padding', '15px 30px');
    await expect(button).toHaveCSS('border-width', '2px');
    await expect(button).toHaveText('Updated Button');
  });

  test('should update styles when imported vindurFn constants change', async ({ page }) => {
    await using env = await startEnv('hot-reload-constants', {
      'constants.ts': dedent`
        import { vindurFn } from "vindur";
        
        export const titleStyles = vindurFn((color: string, size: string) => \`
          color: \${color};
          font-size: \${size};
        \`);
      `,
      'App.tsx': dedent`
        import { css } from "vindur";
        import { titleStyles } from "./constants";

        const titleClass = css\`
          \${titleStyles('red', '16px')}
        \`;

        export default function App() {
          return <h1 className={titleClass}>Hot Reload Test</h1>;
        }
      `,
    });

    await page.goto(env.baseUrl);

    const title = page.locator('h1');
    await expect(title).toHaveCSS('color', 'rgb(255, 0, 0)'); // red
    await expect(title).toHaveCSS('font-size', '16px');

    // Update constants
    env.getFile('constants.ts').write(dedent`
      import { vindurFn } from "vindur";
      
      export const titleStyles = vindurFn((color: string, size: string) => \`
        color: \${color};
        font-size: \${size};
        font-weight: bold;
        text-decoration: underline;
      \`);
    `);

    // Wait for hot reload and check updated styles
    await expect(title).toHaveCSS('font-weight', '700', { timeout: 3000 }); // bold
    await expect(title).toHaveCSS('text-decoration-line', 'underline');
  });

  test('should update styles when imported vindurFn functions change', async ({ page }) => {
    await using env = await startEnv('hot-reload-vindur-fn', {
      'theme.ts': dedent`
        import { vindurFn } from "vindur";

        export const buttonStyles = vindurFn((color: string) => \`
          background: \${color};
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
        \`);
      `,
      'App.tsx': dedent`
        import { css } from "vindur";
        import { buttonStyles } from "./theme";

        const primaryButtonClass = css\`
          \${buttonStyles('green')}
          color: white;
        \`;

        export default function App() {
          return <button className={primaryButtonClass}>Button</button>;
        }
      `,
    });

    await page.goto(env.baseUrl);

    const button = page.locator('button');
    await expect(button).toHaveCSS('background-color', 'rgb(0, 128, 0)'); // green
    await expect(button).toHaveCSS('padding', '10px 20px');
    await expect(button).toHaveCSS('border-radius', '4px');

    // Update vindurFn function
    env.getFile('theme.ts').write(dedent`
      import { vindurFn } from "vindur";

      export const buttonStyles = vindurFn((color: string) => \`
        background: \${color};
        padding: 15px 30px;
        border: 2px solid black;
        border-radius: 8px;
      \`);
    `);

    // Wait for hot reload and check updated styles
    await expect(button).toHaveCSS('padding', '15px 30px', { timeout: 3000 });
    await expect(button).toHaveCSS('border-width', '2px');
    await expect(button).toHaveCSS('border-radius', '8px');
  });

  test('should update styles when imported theme variables change', async ({ page }) => {
    await using env = await startEnv('hot-reload-theme-vars', {
      'theme.ts': dedent`
        import { vindurFn } from "vindur";
        
        export const cardStyles = vindurFn(() => \`
          background: #ff6b6b;
          padding: 16px;
          margin: 8px;
          border-radius: 4px;
        \`);
      `,
      'App.tsx': dedent`
        import { css } from "vindur";
        import { cardStyles } from "./theme";

        const cardClass = css\`
          \${cardStyles()}
        \`;

        export default function App() {
          return (
            <div className={cardClass}>
              <p>Theme Card</p>
            </div>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const card = page.locator('div').first();
    await expect(card).toHaveCSS('background-color', 'rgb(255, 107, 107)'); // #ff6b6b
    await expect(card).toHaveCSS('padding', '16px');
    await expect(card).toHaveCSS('margin', '8px');

    // Update theme variables
    env.getFile('theme.ts').write(dedent`
      import { vindurFn } from "vindur";
      
      export const cardStyles = vindurFn(() => \`
        background: #9b59b6;
        padding: 24px;
        margin: 12px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      \`);
    `);

    // Wait for hot reload and check updated styles
    await expect(card).toHaveCSS('background-color', 'rgb(155, 89, 182)', { timeout: 3000 }); // #9b59b6
    await expect(card).toHaveCSS('padding', '24px');
    await expect(card).toHaveCSS('margin', '12px');
    await expect(card).toHaveCSS('border-radius', '8px');
  });

  test('should update styles when imported string mixins change', async ({ page }) => {
    await using env = await startEnv('hot-reload-mixins', {
      'mixins.ts': dedent`
        export const flexCenter = 'display: flex; align-items: center; justify-content: center;';
        export const cardShadow = 'box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);';
      `,
      'App.tsx': dedent`
        import { css } from "vindur";
        import { flexCenter, cardShadow } from "./mixins";

        const containerClass = css\`
          \${flexCenter}
          \${cardShadow}
          width: 200px;
          height: 100px;
          background: white;
        \`;

        export default function App() {
          return (
            <div className={containerClass}>
              <span>Centered Content</span>
            </div>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const container = page.locator('div').first();
    await expect(container).toHaveCSS('display', 'flex');
    await expect(container).toHaveCSS('align-items', 'center');
    await expect(container).toHaveCSS('justify-content', 'center');
    await expect(container).toHaveCSS('box-shadow', 'rgba(0, 0, 0, 0.1) 0px 2px 4px 0px');

    // Update mixins
    env.getFile('mixins.ts').write(dedent`
      export const flexCenter = 'display: flex; align-items: flex-start; justify-content: flex-end;';
      export const cardShadow = 'box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);';
    `);

    // Wait for hot reload and check updated styles
    await expect(container).toHaveCSS('align-items', 'flex-start', { timeout: 3000 });
    await expect(container).toHaveCSS('justify-content', 'flex-end');
    await expect(container).toHaveCSS('box-shadow', 'rgba(0, 0, 0, 0.2) 0px 4px 8px 0px');
  });

  test('should update styles when deeply imported vindurFn dependencies change', async ({ page }) => {
    await using env = await startEnv('hot-reload-deep-imports', {
      'tokens.ts': dedent`
        import { vindurFn } from "vindur";
        
        export const baseStyles = vindurFn(() => \`
          color: #333;
          font-size: 16px;
        \`);
      `,
      'components.ts': dedent`
        import { vindurFn } from "vindur";
        import { baseStyles } from "./tokens";

        export const textStyles = vindurFn(() => \`
          \${baseStyles()}
          margin-bottom: 8px;
        \`);
      `,
      'App.tsx': dedent`
        import { css } from "vindur";
        import { textStyles } from "./components";

        const containerClass = css\`
          padding: 20px;
        \`;

        const textClass = css\`
          \${textStyles()}
        \`;

        export default function App() {
          return (
            <div className={containerClass}>
              <p className={textClass}>Deep Import Text</p>
            </div>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const container = page.locator('div').first();
    const text = page.locator('p');

    await expect(container).toHaveCSS('padding', '20px');
    await expect(text).toHaveCSS('color', 'rgb(51, 51, 51)'); // #333
    await expect(text).toHaveCSS('font-size', '16px');
    await expect(text).toHaveCSS('margin-bottom', '8px');

    // Update base tokens - this should cascade through the import chain
    env.getFile('tokens.ts').write(dedent`
      import { vindurFn } from "vindur";
      
      export const baseStyles = vindurFn(() => \`
        color: #666;
        font-size: 20px;
        font-weight: bold;
      \`);
    `);

    // Wait for hot reload and check that all derived values update
    await expect(text).toHaveCSS('color', 'rgb(102, 102, 102)', { timeout: 3000 }); // #666
    await expect(text).toHaveCSS('font-size', '20px');
    await expect(text).toHaveCSS('font-weight', '700'); // bold
    await expect(text).toHaveCSS('margin-bottom', '8px'); // Should still be 8px
  });
});