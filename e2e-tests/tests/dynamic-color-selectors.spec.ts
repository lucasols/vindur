import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, startEnvProd, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

const files = {
  'App.tsx': dedent`
    import { styled, createDynamicCssColor } from "vindur";

    const bg = createDynamicCssColor();

    const Card = styled.div\`
      background: \${bg.var};
      outline-style: none;

      \${bg.self.isDark} {
        outline-style: solid;
      }

      \${bg.self.isNotDefined} {
        outline-style: dashed;
      }
    \`;

    const Label = styled.span\`
      font-weight: 400;

      \${bg.container.isLight} & {
        font-weight: 700;
      }

      \${bg.container.isDark} & {
        font-weight: 300;
      }
    \`;

    export default function App() {
      return (
        <div>
          <Card data-testid="dark" dynamicColor={bg.set("#1e293b")}>
            <Label data-testid="dark-label">dark</Label>
          </Card>
          <Card data-testid="light" dynamicColor={bg.set("#f1f5f9")}>
            <Label data-testid="light-label">light</Label>
          </Card>
          <Card data-testid="none" dynamicColor={bg.set(null)}>
            <Label data-testid="none-label">none</Label>
          </Card>
          <div data-testid="scheme" {...bg.setProps("#f1f5f9", { setColorScheme: { fallback: "dark" } })} />
        </div>
      );
    }
  `,
};

async function expectDynamicColorSelectors(target: Page) {
  await expect(target.getByTestId('dark')).toHaveCSS(
    'background-color',
    'rgb(30, 41, 59)',
  );
  await expect(target.getByTestId('dark')).toHaveCSS('outline-style', 'solid');
  await expect(target.getByTestId('light')).toHaveCSS('outline-style', 'none');
  await expect(target.getByTestId('none')).toHaveCSS('outline-style', 'dashed');

  await expect(target.getByTestId('dark-label')).toHaveCSS(
    'font-weight',
    '300',
  );
  await expect(target.getByTestId('light-label')).toHaveCSS(
    'font-weight',
    '700',
  );
  await expect(target.getByTestId('none-label')).toHaveCSS(
    'font-weight',
    '400',
  );

  await expect(target.getByTestId('scheme')).toHaveCSS('color-scheme', 'light');
}

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('dynamic-color-selectors-tests', files);
  await page.goto(env.baseUrl);
});

test.afterAll(async () => {
  await page.close();
  await env.cleanup();
});

test('should apply self and container selectors in dev', async () => {
  await expectDynamicColorSelectors(page);
});

test('should apply self and container selectors in the prod build', async ({
  browser,
}) => {
  const pageProd = await browser.newPage();
  const envProd = await startEnvProd(
    'dynamic-color-selectors-tests-prod',
    files,
  );
  await pageProd.goto(envProd.baseUrl);

  await expectDynamicColorSelectors(pageProd);

  await pageProd.close();
  await envProd.cleanup();
});
