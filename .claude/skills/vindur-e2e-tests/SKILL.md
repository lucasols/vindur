---
name: vindur-e2e-tests
description: Conventions for writing, running, and debugging Playwright e2e tests in e2e-tests/, including the startEnv test structure and what e2e tests should cover. Use before adding, editing, or debugging any e2e test of the vite plugin.
---

# Testing

End-to-end tests use Playwright and are located in `e2e-tests/`. Run them from the e2e-tests directory with `pnpm test` (prefix with `DEBUG=1` for debug logs).

IMPORTANT: Playwright tests already have a 10s timeout configured

# E2E Test Structure

E2E tests follow a consistent pattern for performance and maintainability:

**Key Guidelines:**

- **Prefer reusing `startEnv`** calls, use new ones only if the test requires a different environment
- **Serial execution** with `test.describe.configure({ mode: 'serial' })`
- **Shared setup/teardown** using `beforeAll`/`afterAll` hooks
- **Data-testid selectors** for reliable element targeting
- **Simplified CSS** - minimal CSS for focused testing
- **Test only the core features functionality related to the vite plugin** - implementations details are already tested in lib/ tests, e2e tests should only test if the vite plugin is working as expected
- **Follow Playwright best practices**
- **Tests should be concise**

**Example structure:**

```typescript
test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('test-name', {
    'App.tsx': dedent`
        // Single comprehensive App component
        // covering all test scenarios
      `,
  });
  await page.goto(env.baseUrl);
});

test.afterAll(async () => {
  await page.close();
  await env.cleanup();
});

test('should test feature A', async () => {
  const element = page.getByTestId('test-element');
  await expect(element).toHaveCSS('property', 'value');
});
```

## Debugging

- The `test-results` and `test-runs` are auto generated directories from the `./tests` directory. Focus on the code inside `tests` to find bugs and issues.
