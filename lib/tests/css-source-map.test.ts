import { dedent } from '@ls-stack/utils/dedent';
import { SourceMapConsumer, type RawSourceMap } from 'source-map';
import { describe, expect, test } from 'vitest';
import { transform } from '../src/transform';
import { createFsMock } from './testUtils';

const importAliases = { '#/': '/' };
const emptyFs = createFsMock({});

// Helper function to verify source map mappings
async function verifySourceMapMapping(
  sourceMap: RawSourceMap,
  expectedSourceLine: number,
  expectedSourceColumn: number,
  generatedLine: number = 0, // First line of generated CSS
) {
  const consumer = await new SourceMapConsumer(sourceMap);

  try {
    // Find the original position for the generated position
    const originalPosition = consumer.originalPositionFor({
      line: generatedLine + 1, // Source maps use 1-based line numbers
      column: 0, // Start of the CSS rule
    });

    expect(originalPosition.line).toBe(expectedSourceLine + 1); // Convert to 1-based
    expect(originalPosition.column).toBe(expectedSourceColumn);
    expect(originalPosition.source).toBeTruthy();

    return originalPosition;
  } finally {
    consumer.destroy();
  }
}

describe('CSS source maps', () => {
  test('should generate source map when sourcemap option is enabled', async () => {
    const source = dedent`
      import { css } from 'vindur'

      const style = css\`
        background-color: red;
        color: blue;
      \`

      console.log(style)
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/test.tsx',
      fs: emptyFs,
      transformFunctionCache: {},
      transformDynamicColorCache: {},
      importAliases,
      sourcemap: true,
    });

    // CSS should be generated
    expect(result.css).toMatchInlineSnapshot(`
      ".v1bch0gl-1 {
        background-color: red;
        color: blue;
      }"
    `);

    // Source map should be generated
    expect(result.cssMap).toBeDefined();
    expect(result.cssMap).toHaveProperty('version', 3);
    expect(result.cssMap).toHaveProperty('file', 'test.tsx.css');
    expect(result.cssMap).toHaveProperty('sources');
    expect(result.cssMap).toHaveProperty('sourcesContent');
    expect(result.cssMap).toHaveProperty('mappings');

    // Should have mapping to original source file
    if (result.cssMap) {
      expect(result.cssMap.sources).toContain('/src/test.tsx');
      expect(result.cssMap.sourcesContent).toEqual([source]);
      expect(result.cssMap.mappings).toBeTruthy();

      // Verify that the mapping points to the correct template literal location
      // The template literal starts at line 2 (0-based), at "const style = css`"
      const templateLiteralLine = 2; // Line with the opening backtick
      const templateLiteralColumn =
        source.split('\n')[templateLiteralLine]?.indexOf('`') || 0;

      await verifySourceMapMapping(
        result.cssMap,
        templateLiteralLine,
        templateLiteralColumn,
        0, // First generated CSS line
      );
    }
  });

  test('should not generate source map when sourcemap option is disabled', () => {
    const source = dedent`
      import { css } from 'vindur'

      const style = css\`
        background-color: red;
        color: blue;
      \`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/test.tsx',
      fs: emptyFs,
      transformFunctionCache: {},
      transformDynamicColorCache: {},
      importAliases,
      sourcemap: false,
    });

    // CSS should be generated
    expect(result.css).toMatchInlineSnapshot(`
      ".v1bch0gl-1 {
        background-color: red;
        color: blue;
      }"
    `);

    // Source map should not be generated
    expect(result.cssMap).toBeNull();
  });

  test('should generate source map for multiple CSS rules', async () => {
    const source = dedent`
      import { css } from 'vindur'

      const buttonStyle = css\`
        padding: 10px;
        color: blue;
      \`

      const headerStyle = css\`
        font-size: 24px;
        font-weight: bold;
      \`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/components.tsx',
      dev: true,
      fs: emptyFs,
      transformFunctionCache: {},
      transformDynamicColorCache: {},
      importAliases,
      sourcemap: true,
    });

    // Should have multiple CSS rules
    expect(result.css).toMatchInlineSnapshot(`
      ".vn46gkm-1-buttonStyle {
        padding: 10px;
        color: blue;
      }

      .vn46gkm-2-headerStyle {
        font-size: 24px;
        font-weight: bold;
      }"
    `);

    // Source map should be generated for all rules
    expect(result.cssMap).toBeDefined();
    if (result.cssMap) {
      expect(result.cssMap.sources).toContain('/src/components.tsx');
      expect(result.cssMap.sourcesContent).toEqual([source]);

      // Verify the first CSS rule mapping works
      const firstTemplateLine = 2; // Line with first template literal (0-based)
      const firstTemplateColumn =
        source.split('\n')[firstTemplateLine]?.indexOf('`') || 0;

      await verifySourceMapMapping(
        result.cssMap,
        firstTemplateLine,
        firstTemplateColumn,
        0, // First generated CSS rule
      );

      // Verify the second CSS rule mapping works
      const sourceLines = source.split('\n');
      const secondTemplateLine = sourceLines.findIndex((l) =>
        l.includes('const headerStyle = css`'),
      );
      const secondTemplateColumn =
        (secondTemplateLine >= 0 ?
          sourceLines[secondTemplateLine]?.indexOf('`')
        : 0) || 0;

      const cssLines = (result.css || '').split('\n');
      const secondRuleStartLine = cssLines.findIndex((l) =>
        l.includes('-2-headerStyle'),
      );

      expect(secondRuleStartLine).toBeGreaterThan(0);

      await verifySourceMapMapping(
        result.cssMap,
        secondTemplateLine,
        secondTemplateColumn,
        secondRuleStartLine,
      );
    }
  });

  test('should generate source map for keyframes', () => {
    const source = dedent`
      import { keyframes } from 'vindur'

      const fadeIn = keyframes\`
        from { opacity: 0; }
        to { opacity: 1; }
      \`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/animations.tsx',
      fs: emptyFs,
      transformFunctionCache: {},
      transformDynamicColorCache: {},
      importAliases,
      sourcemap: true,
    });

    // Should have keyframes CSS
    expect(result.css).toMatchInlineSnapshot(`
      "@keyframes v1bvbi9c-1 {
        from { opacity: 0; }
        to { opacity: 1; }
      }"
    `);

    // Source map should be generated
    expect(result.cssMap).toBeDefined();
    if (result.cssMap) {
      expect(result.cssMap.sources).toContain('/src/animations.tsx');
      expect(result.cssMap.sourcesContent).toEqual([source]);
    }
  });

  test('should generate source map for global styles', () => {
    const source = dedent`
      import { createGlobalStyle } from 'vindur'

      createGlobalStyle\`
        body {
          margin: 0;
          padding: 0;
        }
      \`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/global.tsx',
      fs: emptyFs,
      transformFunctionCache: {},
      transformDynamicColorCache: {},
      importAliases,
      sourcemap: true,
    });

    // Should have global CSS
    expect(result.css).toMatchInlineSnapshot(`
      "body {
          margin: 0;
          padding: 0;
        }"
    `);

    // Source map should be generated
    expect(result.cssMap).toBeDefined();
    if (result.cssMap) {
      expect(result.cssMap.sources).toContain('/src/global.tsx');
      expect(result.cssMap.sourcesContent).toEqual([source]);
    }
  });

  test('should handle empty CSS gracefully', () => {
    const source = dedent`
      import { css } from 'vindur'
      // No CSS usage
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/empty.tsx',
      fs: emptyFs,
      transformFunctionCache: {},
      transformDynamicColorCache: {},
      importAliases,
      sourcemap: true,
    });

    // Should have empty CSS
    expect(result.css).toBe('');

    // Source map should be null for empty CSS
    expect(result.cssMap).toBeNull();
  });

  test('should handle mixed CSS and keyframes', () => {
    const source = dedent`
      import { css, keyframes } from 'vindur'

      const slideIn = keyframes\`
        from { transform: translateX(-100%); }
        to { transform: translateX(0); }
      \`

      const animatedBox = css\`
        animation: \${slideIn} 0.3s ease-in;
        background: purple;
      \`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/mixed.tsx',
      fs: emptyFs,
      transformFunctionCache: {},
      transformDynamicColorCache: {},
      importAliases,
      sourcemap: true,
    });

    // Should have both keyframes and CSS
    expect(result.css).toContain('@keyframes');
    expect(result.css).toContain('background: purple');

    // Source map should be generated
    expect(result.cssMap).toBeDefined();
    if (result.cssMap) {
      expect(result.cssMap.sources).toContain('/src/mixed.tsx');
      expect(result.cssMap.sourcesContent).toEqual([source]);
      expect(result.cssMap.mappings).toBeTruthy();
    }
  });
});
