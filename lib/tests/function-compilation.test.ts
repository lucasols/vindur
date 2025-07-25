import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transform, type TransformFunctionCache } from '../src/transform';
import { createFsMock } from './testUtils';

const importAliases = { '#/': '/' };

function createCacheLogger() {
  const cacheLogs: string[] = [];

  return {
    log: (message: string) => {
      if (message.includes('vindur:cache')) {
        cacheLogs.push(message);
      }
    },
    getLogs: () => cacheLogs,
  };
}

describe('function compilation caching', () => {
  test('caches compiled functions on first load', () => {
    const logger = createCacheLogger();
    const fs = createFsMock({
      'styles.ts': dedent`
        import { vindurFn } from 'vindur';

        export const spacing = vindurFn((size: number) => \`margin: \${size}px;\`);
      `,
      'main.ts': dedent`
        import { css } from 'vindur';
        import { spacing } from '#/styles';

        const button = css\`
          \${spacing(16)}
          background: blue;
        \`;
      `,
    });

    const cache: TransformFunctionCache = {};

    transform({
      fileAbsPath: '/main.ts',
      source: fs.readFile('/main.ts'),
      debug: logger,
      transformFunctionCache: cache,
      fs,
      importAliases,
    });

    // Should log exactly once when function is cached for first function load
    const logs = logger.getLogs();
    expect(logs).toMatchInlineSnapshot(`
      [
        "[vindur:cache] Cached function "spacing" in /styles.ts",
      ]
    `);

    expect(cache).toMatchInlineSnapshot(`
      {
        "/main.ts": {},
        "/styles.ts": {
          "spacing": {
            "args": [
              {
                "defaultValue": undefined,
                "name": "size",
                "optional": false,
                "type": "string",
              },
            ],
            "output": [
              {
                "type": "string",
                "value": "margin: ",
              },
              {
                "name": "size",
                "type": "arg",
              },
              {
                "type": "string",
                "value": "px;",
              },
            ],
            "type": "positional",
          },
        },
      }
    `);
  });

  test('uses cached function on subsequent calls', () => {
    const logger = createCacheLogger();
    const fs = createFsMock({
      'styles.ts': dedent`
        import { vindurFn } from 'vindur';

        export const spacing = vindurFn((size: number) => \`margin: \${size}px;\`);
      `,
      'main.ts': dedent`
        import { css } from 'vindur';
        import { spacing } from '#/styles';

        const button = css\`
          \${spacing(8)}
          background: blue;
        \`;

        const card = css\`
          \${spacing(16)}
          background: white;
        \`;
      `,
    });

    const cache: TransformFunctionCache = {};

    transform({
      fileAbsPath: '/main.ts',
      source: fs.readFile('/main.ts'),
      debug: logger,
      transformFunctionCache: cache,
      fs,
      importAliases,
    });

    // Should cache function once, then cache hit for subsequent calls
    const logs = logger.getLogs();
    expect(logs).toMatchInlineSnapshot(`
      [
        "[vindur:cache] Cached function "spacing" in /styles.ts",
        "[vindur:cache] Cache HIT for function "spacing" in /styles.ts",
      ]
    `);
  });

  test('caches functions across multiple transforms with shared state', () => {
    const logger = createCacheLogger();
    const fs = createFsMock({
      'styles.ts': dedent`
        import { vindurFn } from 'vindur';

        export const spacing = vindurFn((size: number) => \`margin: \${size}px;\`);
        export const colors = vindurFn((name: string) => \`color: \${name};\`);
      `,
      'main1.ts': dedent`
        import { css } from 'vindur';
        import { spacing } from '#/styles';

        const button = css\`
          \${spacing(16)}
          background: blue;
        \`;
      `,
      'main2.ts': dedent`
        import { css } from 'vindur';
        import { spacing, colors } from '#/styles';

        const card = css\`
          \${spacing(8)}
          \${colors('red')}
          background: white;
        \`;
      `,
    });

    // Shared cache to persist across transforms
    const sharedCache: TransformFunctionCache = {};

    // First transform - caches both functions in the file
    const result1 = transform({
      fileAbsPath: '/main1.ts',
      source: fs.readFile('/main1.ts'),
      debug: logger,
      transformFunctionCache: sharedCache,
      fs,
      importAliases,
    });

    expect(result1.css).toMatchInlineSnapshot(`
      ".vqqet9a-1 {
        margin: 16px;
        background: blue;
      }"
    `);

    let logs = logger.getLogs();
    expect(logs).toMatchInlineSnapshot(`
      [
        "[vindur:cache] Cached function "spacing" in /styles.ts",
        "[vindur:cache] Cached function "colors" in /styles.ts",
      ]
    `);

    // Reset logger to track second transform
    const logger2 = createCacheLogger();

    // Second transform - both functions are cache hits since the file was already loaded
    const result2 = transform({
      fileAbsPath: '/main2.ts',
      source: fs.readFile('/main2.ts'),
      debug: logger2,
      transformFunctionCache: sharedCache,
      fs,
      importAliases,
    });

    expect(result2.css).toMatchInlineSnapshot(`
      ".v15x2i7v-1 {
        margin: 8px;
        color: red;
        background: white;
      }"
    `);

    logs = logger2.getLogs();
    expect(logs).toMatchInlineSnapshot(`
      [
        "[vindur:cache] Cache HIT for function "spacing" in /styles.ts",
        "[vindur:cache] Cache HIT for function "colors" in /styles.ts",
      ]
    `);
  });

  test('caches functions per file path', () => {
    const logger = createCacheLogger();
    const fs = createFsMock({
      'styles1.ts': dedent`
        import { vindurFn } from 'vindur';

        export const marginFn = vindurFn((size: number) => \`margin: \${size}px;\`);
      `,
      'styles2.ts': dedent`
        import { vindurFn } from 'vindur';

        export const paddingFn = vindurFn((size: number) => \`padding: \${size}px;\`);
      `,
      'main.ts': dedent`
        import { css } from 'vindur';
        import { marginFn } from '#/styles1';
        import { paddingFn } from '#/styles2';

        const button = css\`
          \${marginFn(16)}
          \${paddingFn(8)}
          background: blue;
        \`;
      `,
    });

    const cache: TransformFunctionCache = {};

    transform({
      fileAbsPath: '/main.ts',
      source: fs.readFile('/main.ts'),
      debug: logger,
      transformFunctionCache: cache,
      fs,
      importAliases,
    });

    // Both functions should be cached (different files)
    const logs = logger.getLogs();
    expect(logs).toMatchInlineSnapshot(`
      [
        "[vindur:cache] Cached function "marginFn" in /styles1.ts",
        "[vindur:cache] Cached function "paddingFn" in /styles2.ts",
      ]
    `);
  });

  test('debug logging is optional', () => {
    const fs = createFsMock({
      'styles.ts': dedent`
        import { vindurFn } from 'vindur';

        export const spacing = vindurFn((size: number) => \`margin: \${size}px;\`);
      `,
      'main.ts': dedent`
        import { css } from 'vindur';
        import { spacing } from '#/styles';

        const button = css\`
          \${spacing(16)}
          background: blue;
        \`;
      `,
    });

    const cache: TransformFunctionCache = {};

    // Should not throw when debug is not provided
    expect(() => {
      transform({
        fileAbsPath: '/main.ts',
        source: fs.readFile('/main.ts'),
        transformFunctionCache: cache,
        fs,
        importAliases,
      });
    }).not.toThrow();
  });

  test('tracks cache hits and misses for functions with different parameters', () => {
    const logger = createCacheLogger();
    const fs = createFsMock({
      'styles.ts': dedent`
        import { vindurFn } from 'vindur';

        export const spacing = vindurFn(({ size, type }: { size: number; type: 'margin' | 'padding' }) => 
          \`\${type}: \${size}px;\`
        );
      `,
      'main.ts': dedent`
        import { css } from 'vindur';
        import { spacing } from '#/styles';

        const button = css\`
          \${spacing({ size: 16, type: 'margin' })}
          background: blue;
        \`;

        const card = css\`
          \${spacing({ size: 8, type: 'padding' })}
          background: white;
        \`;
      `,
    });

    const cache: TransformFunctionCache = {};

    transform({
      fileAbsPath: '/main.ts',
      source: fs.readFile('/main.ts'),
      debug: logger,
      transformFunctionCache: cache,
      fs,
      importAliases,
    });

    // Function should be cached after first call, then hit on second call
    const logs = logger.getLogs();
    expect(logs).toMatchInlineSnapshot(`
      [
        "[vindur:cache] Cached function "spacing" in /styles.ts",
        "[vindur:cache] Cache HIT for function "spacing" in /styles.ts",
      ]
    `);
  });

  test('function cache persists between different functions in same file', () => {
    const logger = createCacheLogger();
    const fs = createFsMock({
      'styles.ts': dedent`
        import { vindurFn } from 'vindur';

        export const spacing = vindurFn((size: number) => \`margin: \${size}px;\`);
        export const padding = vindurFn((size: number) => \`padding: \${size}px;\`);
      `,
      'main.ts': dedent`
        import { css } from 'vindur';
        import { spacing, padding } from '#/styles';

        const button = css\`
          \${spacing(16)}
          background: blue;
        \`;

        const card = css\`
          \${padding(8)}
          \${spacing(4)}
          background: white;
        \`;
      `,
    });

    const cache: TransformFunctionCache = {};

    transform({
      fileAbsPath: '/main.ts',
      source: fs.readFile('/main.ts'),
      debug: logger,
      transformFunctionCache: cache,
      fs,
      importAliases,
    });

    // First CSS block: spacing loads the file and caches both functions
    // Second CSS block: padding cache hit (already cached), then spacing cache hit
    const logs = logger.getLogs();
    expect(logs).toMatchInlineSnapshot(`
      [
        "[vindur:cache] Cached function "spacing" in /styles.ts",
        "[vindur:cache] Cached function "padding" in /styles.ts",
        "[vindur:cache] Cache HIT for function "padding" in /styles.ts",
        "[vindur:cache] Cache HIT for function "spacing" in /styles.ts",
      ]
    `);
  });
});
