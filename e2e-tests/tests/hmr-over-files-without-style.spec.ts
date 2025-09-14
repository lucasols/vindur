import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from '@playwright/test';
import { startEnv } from '../utils/startEnv';

// Reproduces a bug where changing other files with no vindur usage was not reflected in the page.
test('should reflect changes in other files with no vindur usage', async ({
  page,
}) => {
  await using env = await startEnv('css-hmr-over-files-without-style', {
    'App.tsx': dedent`
      import { css } from "vindur";
      import { Component } from "#src/Component";
      import { bgColor } from "#src/styleHelpers";

      const styles = css\`
        \${bgColor('red')};
        color: white;
        border: 4px solid rgb(1, 2, 3);
        letter-spacing: 30px;
      \`;

      export default function App() {
        return <div data-testid="box" className={styles}>
          <Component />
        </div>;
      }
    `,
    'Component.tsx': dedent`
      export const Component = () => <div>Text</div>;
    `,
    'styleHelpers.ts': dedent`
      import { vindurFn } from "vindur";
      export const bgColor = vindurFn((color: string) => \`background-color: \${color}\`);
    `,
  });

  await page.goto(env.baseUrl);
  const box = page.getByTestId('box');
  await expect(box).toBeVisible();

  // Ensure initial styles took effect
  await expect(box).toHaveCSS('background-color', 'rgb(255, 0, 0)');
  await expect(box).toHaveText('Text');

  // Update the App.tsx file with a new style
  env.getFile('App.tsx').replace("'red'", "'blue'");
  await expect(box).toHaveCSS('background-color', 'rgb(0, 0, 255)');

  // vindur should not interfere with hmr over other files not using vindur
  // Update the Component.tsx file with a new text
  env.getFile('Component.tsx').replace('Text', 'Text Updated');
  await expect(box).toHaveText('Text Updated');
});
