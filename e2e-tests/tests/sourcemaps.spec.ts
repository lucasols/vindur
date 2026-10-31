import { dedent } from '@ls-stack/utils/dedent';
import { __LEGIT_CAST__ } from '@ls-stack/utils/saferTyping';
import { expect, test } from '@playwright/test';
import { SourceMapConsumer, type RawSourceMap } from 'source-map';
import type { TestEnv } from '../utils/startEnv';
import { startEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;

const appSource = dedent`
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

  const label = 'mapped-label';

  export default function App() {
    return (
      <div>
        <div data-testid="box" className={box}>box</div>
        <Button data-testid="button">click</Button>
        <span data-testid="label">{label}</span>
      </div>
    );
  }
`;

test.beforeAll(async () => {
  env = await startEnv('sourcemaps', { 'App.tsx': appSource });
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

test('maps the compiled JS back to the source', async () => {
  const response = await fetch(`${env.baseUrl}/App.tsx`);
  const code = await response.text();

  const mapBase64 =
    code.split('sourceMappingURL=data:application/json;base64,')[1] ?? '';
  const map = __LEGIT_CAST__<RawSourceMap>(
    JSON.parse(Buffer.from(mapBase64, 'base64').toString('utf-8')),
  );

  // The opening quote of the string, whichever quotes the output uses
  const index = code.indexOf('mapped-label') - 1;
  const before = code.slice(0, index);
  const consumer = await new SourceMapConsumer(map);
  const original = consumer.originalPositionFor({
    line: before.split('\n').length,
    column: index - before.lastIndexOf('\n') - 1,
  });
  consumer.destroy();

  const sourceIndex = appSource.indexOf('mapped-label') - 1;
  const sourceBefore = appSource.slice(0, sourceIndex);
  expect({ line: original.line, column: original.column }).toEqual({
    line: sourceBefore.split('\n').length,
    column: sourceIndex - sourceBefore.lastIndexOf('\n') - 1,
  });
});
