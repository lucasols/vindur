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

test('should update imported css when external file changes', async ({ page }) => {
  await using env = await startEnv('hot-reload-css-import', {
    'styles.ts': dedent`
      import { css } from "vindur";

      export const boxStyles = css\`
        background: red;
        padding: 20px;
        color: white;
        border-radius: 4px;
      \`;
    `,
    'App.tsx': dedent`
      import { boxStyles } from "#src/styles";

      export default function App() {
        return (
          <div data-testid="box" className={boxStyles}>
            CSS Import Test
          </div>
        );
      }
    `,
  });

  await page.goto(env.baseUrl);
  const box = page.getByTestId('box');

  await expect(box).toHaveCSS('background-color', 'rgb(255, 0, 0)'); // red
  await expect(box).toHaveCSS('padding', '20px');

  // First update - change background color
  env.getFile('styles.ts').replace('background: red;', 'background: blue;');
  await expect(box).toHaveCSS('background-color', 'rgb(0, 0, 255)'); // blue

  // Second update - change padding
  env.getFile('styles.ts').replace('padding: 20px;', 'padding: 30px;');
  await expect(box).toHaveCSS('padding', '30px');

  // Third update - change background again
  env.getFile('styles.ts').replace('background: blue;', 'background: green;');
  await expect(box).toHaveCSS('background-color', 'rgb(0, 128, 0)'); // green

  // Revert to original state
  env.getFile('styles.ts').replace('background: green;', 'background: red;');
  env.getFile('styles.ts').replace('padding: 30px;', 'padding: 20px;');
  await expect(box).toHaveCSS('background-color', 'rgb(255, 0, 0)'); // red
  await expect(box).toHaveCSS('padding', '20px');
});

test('should update imported styled component when external file changes', async ({ page }) => {
  await using env = await startEnv('hot-reload-styled-import', {
    'components.ts': dedent`
      import { styled } from "vindur";

      export const StyledButton = styled.button\`
        background: red;
        color: white;
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        font-weight: normal;
      \`;
    `,
    'App.tsx': dedent`
      import { StyledButton } from "#src/components";

      export default function App() {
        return (
          <StyledButton data-testid="button">
            Styled Import Test
          </StyledButton>
        );
      }
    `,
  });

  await page.goto(env.baseUrl);
  const button = page.getByTestId('button');

  await expect(button).toHaveCSS('background-color', 'rgb(255, 0, 0)'); // red
  await expect(button).toHaveCSS('padding', '10px 20px');

  // First update - change background
  env.getFile('components.ts').replace('background: red;', 'background: blue;');
  await expect(button).toHaveCSS('background-color', 'rgb(0, 0, 255)'); // blue

  // Second update - change padding 
  env.getFile('components.ts').replace('padding: 10px 20px;', 'padding: 15px 30px;');
  await expect(button).toHaveCSS('padding', '15px 30px');

  // Third update - change background again
  env.getFile('components.ts').replace('background: blue;', 'background: purple;');
  await expect(button).toHaveCSS('background-color', 'rgb(128, 0, 128)'); // purple

  // Revert to original state
  env.getFile('components.ts').replace('background: purple;', 'background: red;');
  env.getFile('components.ts').replace('padding: 15px 30px;', 'padding: 10px 20px;');
  await expect(button).toHaveCSS('background-color', 'rgb(255, 0, 0)'); // red
  await expect(button).toHaveCSS('padding', '10px 20px');
});

test('should update imported keyframes when external file changes', async ({ page }) => {
  await using env = await startEnv('hot-reload-keyframes-import', {
    'animations.ts': dedent`
      import { css, keyframes } from "vindur";

      const fadeIn = keyframes\`
        from { 
          opacity: 0; 
          transform: translateY(10px);
        }
        to { 
          opacity: 1; 
          transform: translateY(0);
        }
      \`;

      export const animatedStyles = css\`
        animation: \${fadeIn} 1s ease;
        background: red;
        padding: 20px;
        color: white;
        border-radius: 4px;
      \`;
    `,
    'App.tsx': dedent`
      import { animatedStyles } from "#src/animations";

      export default function App() {
        return (
          <div data-testid="box" className={animatedStyles}>
            Keyframes Import Test
          </div>
        );
      }
    `,
  });

  await page.goto(env.baseUrl);
  const box = page.getByTestId('box');

  await expect(box).toHaveCSS('background-color', 'rgb(255, 0, 0)'); // red
  await expect(box).toHaveCSS('padding', '20px');

  // First update - change background
  env.getFile('animations.ts').replace('background: red;', 'background: blue;');
  await expect(box).toHaveCSS('background-color', 'rgb(0, 0, 255)'); // blue

  // Second update - change keyframe values
  env.getFile('animations.ts').replace('transform: translateY(10px);', 'transform: translateY(20px);');
  
  // Third update - change background again
  env.getFile('animations.ts').replace('background: blue;', 'background: green;');
  await expect(box).toHaveCSS('background-color', 'rgb(0, 128, 0)'); // green

  // Revert to original state
  env.getFile('animations.ts').replace('background: green;', 'background: red;');
  env.getFile('animations.ts').replace('transform: translateY(20px);', 'transform: translateY(10px);');
  await expect(box).toHaveCSS('background-color', 'rgb(255, 0, 0)'); // red
});

test('should update imported theme colors when external file changes', async ({ page }) => {
  await using env = await startEnv('hot-reload-theme-import', {
    'theme.ts': dedent`
      import { css, createStaticThemeColors } from "vindur";

      const colors = createStaticThemeColors({
        primary: '#ff0000',
        secondary: '#00ff00',
        accent: '#ff00ff'
      });

      export const themeStyles = css\`
        background: \${colors.primary};
        color: white;
        padding: 20px;
        border-radius: 8px;
        margin: 10px;
      \`;

      export const secondaryStyles = css\`
        background: \${colors.secondary};
        color: black;
        padding: 15px;
      \`;
    `,
    'App.tsx': dedent`
      import { themeStyles, secondaryStyles } from "#src/theme";

      export default function App() {
        return (
          <div>
            <div data-testid="primary-box" className={themeStyles}>
              Primary Theme
            </div>
            <div data-testid="secondary-box" className={secondaryStyles}>
              Secondary Theme
            </div>
          </div>
        );
      }
    `,
  });

  await page.goto(env.baseUrl);
  const primaryBox = page.getByTestId('primary-box');
  const secondaryBox = page.getByTestId('secondary-box');

  await expect(primaryBox).toHaveCSS('background-color', 'rgb(255, 0, 0)'); // red
  await expect(secondaryBox).toHaveCSS('background-color', 'rgb(0, 255, 0)'); // green

  // First update - change primary color
  env.getFile('theme.ts').replace("primary: '#ff0000'", "primary: '#0000ff'");
  await expect(primaryBox).toHaveCSS('background-color', 'rgb(0, 0, 255)'); // blue

  // Second update - change secondary color
  env.getFile('theme.ts').replace("secondary: '#00ff00'", "secondary: '#ffff00'");
  await expect(secondaryBox).toHaveCSS('background-color', 'rgb(255, 255, 0)'); // yellow

  // Third update - change primary color again
  env.getFile('theme.ts').replace("primary: '#0000ff'", "primary: '#800080'");
  await expect(primaryBox).toHaveCSS('background-color', 'rgb(128, 0, 128)'); // purple

  // Revert to original state
  env.getFile('theme.ts').replace("primary: '#800080'", "primary: '#ff0000'");
  env.getFile('theme.ts').replace("secondary: '#ffff00'", "secondary: '#00ff00'");
  await expect(primaryBox).toHaveCSS('background-color', 'rgb(255, 0, 0)'); // red
  await expect(secondaryBox).toHaveCSS('background-color', 'rgb(0, 255, 0)'); // green
});
