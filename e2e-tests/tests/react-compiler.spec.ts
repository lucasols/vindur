import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, startEnvProd, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

const files = {
  'App.tsx': dedent`
    import { useState } from "react";
    import { css, styled, createDynamicCssColor } from "vindur";

    const Card = styled.div\`
      padding: 12px;
    \`;

    const color = createDynamicCssColor();

    export const ExportedButton = styled.button\`
      border: none;
      background: \${color.var};
    \`;

    export const Badge = styled.span<{ active: boolean }>\`
      color: rgb(0, 0, 0);

      &.active {
        color: rgb(255, 0, 0);
      }
    \`;

    const textStyle = css\`
      font-size: 20px;
    \`;

    export default function App() {
      const [active, setActive] = useState(false);
      const rest = { title: "card" };

      return (
        <Card data-testid="card" {...rest}>
          <div data-testid="css-prop" css={\`margin: 4px;\`} className={textStyle} />
          <div data-testid="cx-prop" cx={{ selected: active }} css={\`
            &.selected { background: rgb(0, 0, 255); }
          \`} />
          <Badge data-testid="badge" active={active}>badge</Badge>
          <ExportedButton
            data-testid="button"
            dynamicColor={color.set(active ? "#00ff00" : "#ff0000")}
            onClick={() => setActive(!active)}
          >
            toggle
          </ExportedButton>
        </Card>
      );
    }
  `,
};

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('react-compiler-tests', files, {
    reactPlugin: 'oxc-compiler',
  });
  await page.goto(env.baseUrl);
});

test.afterAll(async () => {
  await page.close();
  await env.cleanup();
});

test('should run the React Compiler over vindur output', async () => {
  const response = await fetch(`${env.baseUrl}/App.tsx`);
  const code = await response.text();

  // vindur runs before the compiler, so no css/cx props or CSS reach it
  expect(code).toContain('compiler-runtime');
  expect(code).not.toContain('margin: 4px');
  expect(code).not.toContain('cx:');
});

async function expectStylesAndToggle(target: Page) {
  await expect(target.getByTestId('card')).toHaveCSS('padding', '12px');
  await expect(target.getByTestId('card')).toHaveAttribute('title', 'card');
  await expect(target.getByTestId('css-prop')).toHaveCSS('margin', '4px');
  await expect(target.getByTestId('css-prop')).toHaveCSS('font-size', '20px');
  await expect(target.getByTestId('badge')).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(target.getByTestId('button')).toHaveCSS(
    'background-color',
    'rgb(255, 0, 0)',
  );

  await target.getByTestId('button').click();

  await expect(target.getByTestId('cx-prop')).toHaveCSS(
    'background-color',
    'rgb(0, 0, 255)',
  );
  await expect(target.getByTestId('badge')).toHaveCSS(
    'color',
    'rgb(255, 0, 0)',
  );
  await expect(target.getByTestId('button')).toHaveCSS(
    'background-color',
    'rgb(0, 255, 0)',
  );
}

test('should apply styles and react to state with the React Compiler', async () => {
  await expectStylesAndToggle(page);
});

test('should apply styles with the React Compiler (prod build)', async ({
  browser,
}) => {
  const pageProd = await browser.newPage();
  const envProd = await startEnvProd('react-compiler-tests-prod', files, {
    reactPlugin: 'oxc-compiler',
  });
  await pageProd.goto(envProd.baseUrl);

  await expectStylesAndToggle(pageProd);

  await pageProd.close();
  await envProd.cleanup();
});
