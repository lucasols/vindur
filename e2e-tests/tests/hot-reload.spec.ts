import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from '@playwright/test';
import { startEnv } from '../utils/startEnv';
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
      return <h1 data-testid="title" className={titleClass}>Self Hot Reload Updated</h1>;
    }
  `);

  // Wait for hot reload and check updated styles
  await expect(title).toHaveCSS('color', 'rgb(0, 0, 255)', { timeout: 3000 }); // blue
  await expect(title).toHaveCSS('font-size', '32px');
  await expect(title).toHaveCSS('font-weight', '400'); // normal
  await expect(title).toHaveCSS('text-decoration-line', 'underline');
  await expect(title).toHaveText('Self Hot Reload Updated');
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
          <Container data-testid="container">
            <Button data-testid="button">Updated Button</Button>
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

test('should update styles when imported vindurFn constants change', async ({
  page,
}) => {
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
      import { titleStyles } from "#src/constants";

      const titleClass = css\`
        \${titleStyles('red', '16px')}
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

test('should update styles when imported vindurFn functions change', async ({
  page,
}) => {
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
      import { buttonStyles } from "#src/theme";

      const primaryButtonClass = css\`
        \${buttonStyles('green')}
        color: white;
      \`;

      export default function App() {
        return <button data-testid="button" className={primaryButtonClass}>Button</button>;
      }
    `,
  });

  await page.goto(env.baseUrl);

  const button = page.getByTestId('button');
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

test('should update styles when imported theme variables change', async ({
  page,
}) => {
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
      import { cardStyles } from "#src/theme";

      const cardClass = css\`
        \${cardStyles()}
      \`;

      export default function App() {
        return (
          <div data-testid="card" className={cardClass}>
            <p>Theme Card</p>
          </div>
        );
      }
    `,
  });

  await page.goto(env.baseUrl);

  const card = page.getByTestId('card');
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
  await expect(card).toHaveCSS('background-color', 'rgb(155, 89, 182)', {
    timeout: 3000,
  }); // #9b59b6
  await expect(card).toHaveCSS('padding', '24px');
  await expect(card).toHaveCSS('margin', '12px');
  await expect(card).toHaveCSS('border-radius', '8px');
});

test('should update styles when imported vindurFn mixins change', async ({
  page,
}) => {
  await using env = await startEnv('hot-reload-mixins', {
    'mixins.ts': dedent`
      import { vindurFn } from "vindur";

      export const flexCenter = vindurFn(() => \`display: flex; align-items: center; justify-content: center;\`);
      export const cardShadow = vindurFn(() => \`box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);\`);
    `,
    'App.tsx': dedent`
      import { css } from "vindur";
      import { flexCenter, cardShadow } from "#src/mixins";

      const containerClass = css\`
        \${flexCenter()}
        \${cardShadow()}
        width: 200px;
        height: 100px;
        background: white;
      \`;

      export default function App() {
        return (
          <div data-testid="container" className={containerClass}>
            <span>Centered Content</span>
          </div>
        );
      }
    `,
  });

  await page.goto(env.baseUrl);

  const container = page.getByTestId('container');
  await expect(container).toHaveCSS('display', 'flex');
  await expect(container).toHaveCSS('align-items', 'center');
  await expect(container).toHaveCSS('justify-content', 'center');
  await expect(container).toHaveCSS(
    'box-shadow',
    'rgba(0, 0, 0, 0.1) 0px 2px 4px 0px',
  );

  // Update mixins
  env.getFile('mixins.ts').write(dedent`
    import { vindurFn } from "vindur";

    export const flexCenter = vindurFn(() => \`display: flex; align-items: flex-start; justify-content: flex-end;\`);
    export const cardShadow = vindurFn(() => \`box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);\`);
  `);

  // Wait for hot reload and check updated styles
  await expect(container).toHaveCSS('align-items', 'flex-start', {
    timeout: 3000,
  });
  await expect(container).toHaveCSS('justify-content', 'flex-end');
  await expect(container).toHaveCSS(
    'box-shadow',
    'rgba(0, 0, 0, 0.2) 0px 4px 8px 0px',
  );
});

test('should update styles when deeply imported vindurFn dependencies change', async ({
  page,
}) => {
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

      export const textStyles = vindurFn(() => \`
        color: #333;
        font-size: 16px;
        margin-bottom: 8px;
      \`);
    `,
    'App.tsx': dedent`
      import { css } from "vindur";
      import { textStyles } from "#src/components";
      import { baseStyles } from "#src/tokens";

      const containerClass = css\`
        padding: 20px;
      \`;

      const textClass = css\`
        \${textStyles()}
      \`;

      const baseClass = css\`
        \${baseStyles()}
      \`;

      export default function App() {
        return (
          <div data-testid="container" className={containerClass}>
            <p data-testid="text" className={textClass}>Deep Import Text</p>
            <span data-testid="base-element" className={baseClass}>Base styles</span>
          </div>
        );
      }
    `,
  });

  await page.goto(env.baseUrl);

  const container = page.getByTestId('container');
  const text = page.getByTestId('text');
  const baseElement = page.getByTestId('base-element');

  await expect(container).toHaveCSS('padding', '20px');
  await expect(text).toHaveCSS('color', 'rgb(51, 51, 51)'); // #333
  await expect(text).toHaveCSS('font-size', '16px');
  await expect(text).toHaveCSS('margin-bottom', '8px');
  await expect(baseElement).toHaveCSS('color', 'rgb(51, 51, 51)'); // #333
  await expect(baseElement).toHaveCSS('font-size', '16px');

  // Update base tokens - this should be reflected in the base element
  env.getFile('tokens.ts').write(dedent`
    import { vindurFn } from "vindur";

    export const baseStyles = vindurFn(() => \`
      color: #666;
      font-size: 20px;
      font-weight: bold;
    \`);
  `);

  // Wait for hot reload and check updated styles on base element
  await expect(baseElement).toHaveCSS('color', 'rgb(102, 102, 102)', {
    timeout: 3000,
  }); // #666
  await expect(baseElement).toHaveCSS('font-size', '20px');
  await expect(baseElement).toHaveCSS('font-weight', '700'); // bold

  // Text element should remain unchanged since it doesn't depend on baseStyles
  await expect(text).toHaveCSS('color', 'rgb(51, 51, 51)'); // #333
  await expect(text).toHaveCSS('margin-bottom', '8px');
});
