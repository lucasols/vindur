---
name: vindur-lib-tests
description: Conventions for writing and changing Vitest tests in lib/tests/, including the transformWithFormat test template, snapshot style, and test utility rules. Use before adding, editing, or fixing any test under lib/.
---

# Testing

Tests use Vitest and are located in `lib/tests/`. Run them from the lib directory with `pnpm test`.

- Prefer using `toMatchInlineSnapshot` when possible
- Do not update snapshots via `vitest run --u`, update them manually
- If there are too many snapshots to update manually, ask for the user to update them
- Do not use top level `describe` in tests to group all tests in a file, use describe to group tests only

- Use `compactSnapshot` when possible for inline snapshots of objects and arrays, it produces more readable snapshots in yaml format

# Transform tests

Tests for transform function should follow this structure:

```tsx
import { describe, expect, test } from 'vitest';
import { dedent } from '@ls-stack/utils/dedent';
import { transformWithFormat } from './testUtils';
// ...

test('should handle ...', async () => {
  const result = await transformWithFormat({
    // source should be inlined if it is not used multiple times
    source: dedent`
      // ...
    `,
    // prefer using default props for `fs` and `importAliases` unless the test requires it
  });

  // code assertion should come first, then css assertion
  expect(result.code).toMatchInlineSnapshot(`
    // ...
  `);

  expect(result.css).toMatchInlineSnapshot(`
    // ...
  `);
});
```

DON'T DO THIS:

- using `toContain` instead of `toMatchInlineSnapshot`

# Test Utility Memories

- `overrideDefaultFs` should use `createFsMock`
- do not use `overrideDefaultFs` and `overrideDefaultImportAliases` when using the default values
