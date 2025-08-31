import { dedent } from '@ls-stack/utils/dedent';
import { __LEGIT_CAST__ } from '@ls-stack/utils/saferTyping';
import { expect, test } from '@playwright/test';
import type { TestEnv } from '../utils/startEnv';
import { startEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;

test.beforeAll(async () => {
  env = await startEnv('sourcemaps', {
    'App.tsx': dedent`
      import { css, styled, createGlobalStyle } from 'vindur'

      createGlobalStyle\`
        :root { --check: 1 }
      \`

      const box = css\`
        color: red;
      \`

      const Button = styled.button\`
        background: blue;
        color: white;
      \`

      export default function App() {
        return (
          <div>
            <div data-testid="box" className={box}>box</div>
            <Button data-testid="button">click</Button>
          </div>
        );
      }
    `,
  });
});

test.afterAll(async () => {
  await env.cleanup();
});

test('emits CSS with inline sourcemaps', async ({ page }) => {
  await page.goto(env.baseUrl);

  // Wait for elements so styles are applied
  await expect(page.getByTestId('box')).toHaveText('box');
  await expect(page.getByTestId('button')).toHaveText('click');

  // Find a Vindur virtual CSS style tag and fetch its source from Vite using data-vite-dev-id
  const styleId = await page.evaluate(() => {
    const styles = Array.from(document.querySelectorAll('style'));
    const target = styles.find((s) =>
      s.getAttribute('data-vite-dev-id')?.includes('virtual:vindur'),
    );
    return target?.getAttribute('data-vite-dev-id') || '';
  });

  expect(styleId).toContain('virtual:vindur');

  const cssText = await page.evaluate(async (id) => {
    const url = id.startsWith('/@id/') ? id : `/@id/${id}`;
    const res = await fetch(url);
    return res.ok ? await res.text() : '';
  }, styleId);

  // Validate CSS response contains inline sourcemap
  expect(cssText).toContain('sourceMappingURL=data:application/json;base64,');

  // Validate the map decodes and points to App.tsx
  const mapBase64 =
    cssText
      .split('sourceMappingURL=data:application/json;base64,')[1]
      ?.split('*/')
      .at(0) ?? '';
  expect(mapBase64.length).toBeGreaterThan(0);

  const mapJson = Buffer.from(mapBase64, 'base64').toString('utf-8');
  const map = __LEGIT_CAST__<{ sources?: string[] }>(JSON.parse(mapJson));
  expect(Array.isArray(map.sources)).toBe(true);
  expect(map.sources?.some((s) => s.includes('App.tsx'))).toBe(true);
});
