import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transform } from '../../src/transform';
import { createFsMock } from '../testUtils';

// Top-level regexes to avoid creating new RegExp objects on each function call
const CLASS_PATTERN_REGEX = /\.v[a-z0-9]+-1 \{/;
const CLASS_NAME_REGEX = /^const style = "v[a-z0-9]+-1";$/;

const importAliases = { '#/': '/' };

const emptyFs = createFsMock({});

describe('class generation', () => {
  test('should transform css styles', () => {
    const source = dedent`
      import { css } from 'vindur'

      const style = css\`
        background-color: red;
      \`

      console.log(style)
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/test.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vmcre00-1 {
        background-color: red;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const style = "vmcre00-1";
      console.log(style);"
    `);
  });

  test('should transform css styles in dev mode with variable names', () => {
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

      console.log(buttonStyle, headerStyle)
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/components.ts',
      dev: true,
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vcixwtu-1-buttonStyle {
        padding: 10px;
        color: blue;
      }

      .vcixwtu-2-headerStyle {
        font-size: 24px;
        font-weight: bold;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const buttonStyle = "vcixwtu-1-buttonStyle";
      const headerStyle = "vcixwtu-2-headerStyle";
      console.log(buttonStyle, headerStyle);"
    `);
  });
});

describe('interpolation', () => {
  test('DEBUG: should resolve simple variables at compile time', () => {
    const source = dedent`
      import { css } from 'vindur'

      const primaryColor = 'blue'
      const fontSize = 16

      const style = css\`
        color: \${primaryColor};
        font-size: \${fontSize}px;
      \`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/debug.ts',
      fs: emptyFs,
      importAliases,
    });

    // This should now contain resolved values, not placeholders
    expect(result.css).toMatchInlineSnapshot(`
      ".vhqnxci-1 {
        color: blue;
        font-size: 16px;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const primaryColor = 'blue';
      const fontSize = 16;
      const style = "vhqnxci-1";"
    `);
  });

  test('should handle variable interpolation in css styles', () => {
    const source = dedent`
      import { css } from 'vindur'

      const primaryColor = 'blue'
      const fontSize = 16

      const style = css\`
        color: \${primaryColor};
        font-size: \${fontSize}px;
        background: \${'red'};
      \`

      console.log(style)
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/interpolation.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v9525ba-1 {
        color: blue;
        font-size: 16px;
        background: red;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const primaryColor = 'blue';
      const fontSize = 16;
      const style = "v9525ba-1";
      console.log(style);"
    `);
  });

  test('should resolve valid variable references within the same file', () => {
    const source = dedent`
      import { css } from 'vindur'

      const margin = 10
      const padding = margin * 2

      const style = css\`
        margin: \${margin}px;
        padding: \${padding}px;
      \`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/variables.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vo47uo2-1 {
        margin: 10px;
        padding: 20px;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const margin = 10;
      const padding = margin * 2;
      const style = "vo47uo2-1";"
    `);
  });

  test('should throw error for complex expressions in interpolation', () => {
    const source = dedent`
      import { css } from 'vindur'

      const obj = { color: 'red' }
      const arr = [1, 2, 3]

      const style = css\`
        color: \${obj.color};
        font-size: \${arr[0]}px;
        background: \${Math.max(10, 20)}px;
      \`
    `;

    expect(() => {
      transform({
        source,
        fileAbsPath: '/src/complex.ts',
        fs: emptyFs,
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /src/complex.ts: Invalid interpolation used at \`... style = css\` ... \${obj.color}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
      loc: {
        "column": 11,
        "filename": undefined,
        "line": 7,
      }]
    `,
    );
  });

  test('should handle nested template literals', () => {
    const source = dedent`
      import { css } from 'vindur'

      const prefix = 'my'
      const suffix = 'class'

      const style = css\`
        content: "\${prefix}-\${suffix}";
      \`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/nested.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vmgoafb-1 {
        content: "my-class";
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const prefix = 'my';
      const suffix = 'class';
      const style = "vmgoafb-1";"
    `);
  });

  test('should throw error for undefined variable references', () => {
    const source = dedent`
      import { css } from 'vindur'

      const style = css\`
        color: \${undefinedVariable};
      \`
    `;

    expect(() => {
      transform({
        source,
        fileAbsPath: '/src/undefined.ts',
        fs: emptyFs,
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /src/undefined.ts: Invalid interpolation used at \`... style = css\` ... \${undefinedVariable}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
      loc: {
        "column": 11,
        "filename": undefined,
        "line": 4,
      }
      ignoreInLint: true]
    `,
    );
  });
});

describe('error handling', () => {
  test('should throw error for object property access', () => {
    const source = dedent`
      import { css } from 'vindur'

      const theme = { primary: 'blue' }
      const style = css\`
        color: \${theme.primary};
      \`
    `;

    expect(() => {
      transform({
        source,
        fileAbsPath: '/src/object.ts',
        fs: emptyFs,
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /src/object.ts: Invalid interpolation used at \`... style = css\` ... \${theme.primary}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
      loc: {
        "column": 11,
        "filename": undefined,
        "line": 5,
      }]
    `,
    );
  });

  test('should throw error for array access', () => {
    const source = dedent`
      import { css } from 'vindur'

      const colors = ['red', 'blue', 'green']
      const style = css\`
        color: \${colors[0]};
      \`
    `;

    expect(() => {
      transform({
        source,
        fileAbsPath: '/src/array.ts',
        fs: emptyFs,
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /src/array.ts: Invalid interpolation used at \`... style = css\` ... \${colors[0]}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
      loc: {
        "column": 11,
        "filename": undefined,
        "line": 5,
      }]
    `,
    );
  });

  test('should throw error for function calls', () => {
    const source = dedent`
      import { css } from 'vindur'

      const style = css\`
        width: \${Math.max(10, 20)}px;
      \`
    `;

    expect(() => {
      transform({
        source,
        fileAbsPath: '/src/function.ts',
        fs: emptyFs,
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /src/function.ts: Unresolved function call at \`... style = css\` ... \${Math.max(10, 20)}, function must be statically analyzable and correctly imported with the configured aliases
      loc: {
        "column": 11,
        "filename": undefined,
        "line": 4,
      }]
    `,
    );
  });

  test('should throw error for conditional expressions', () => {
    const source = dedent`
      import { css } from 'vindur'

      const a = 5
      const b = 10
      const style = css\`
        width: \${a > b ? a : b}px;
      \`
    `;

    expect(() => {
      transform({
        source,
        fileAbsPath: '/src/conditional.ts',
        fs: emptyFs,
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /src/conditional.ts: Invalid interpolation used at \`... style = css\` ... \${a > b ? a : b}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
      loc: {
        "column": 11,
        "filename": undefined,
        "line": 6,
      }]
    `,
    );
  });

  test('should throw error for logical expressions', () => {
    const source = dedent`
      import { css } from 'vindur'

      const visible = true
      const enabled = false
      const style = css\`
        display: \${visible && enabled ? 'block' : 'none'};
      \`
    `;

    expect(() => {
      transform({
        source,
        fileAbsPath: '/src/logical.ts',
        fs: emptyFs,
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /src/logical.ts: Invalid interpolation used at \`... style = css\` ... \${visible && enabled ? 'block' : 'none'}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
      loc: {
        "column": 13,
        "filename": undefined,
        "line": 6,
      }]
    `,
    );
  });

  test('should throw error for unary expressions', () => {
    const source = dedent`
      import { css } from 'vindur'

      const condition = true
      const style = css\`
        display: \${!condition ? 'none' : 'block'};
      \`
    `;

    expect(() => {
      transform({
        source,
        fileAbsPath: '/src/unary.ts',
        fs: emptyFs,
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /src/unary.ts: Invalid interpolation used at \`... style = css\` ... \${!condition ? 'none' : 'block'}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
      loc: {
        "column": 13,
        "filename": undefined,
        "line": 5,
      }]
    `,
    );
  });

  test('should throw error for array literals', () => {
    const source = dedent`
      import { css } from 'vindur'

      const style = css\`
        background: \${['red', 'blue'][0]};
      \`
    `;

    expect(() => {
      transform({
        source,
        fileAbsPath: '/src/array-literal.ts',
        fs: emptyFs,
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /src/array-literal.ts: Invalid interpolation used at \`... style = css\` ... \${['red', 'blue'][0]}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
      loc: {
        "column": 16,
        "filename": undefined,
        "line": 4,
      }]
    `,
    );
  });

  test('should show actual variable name in error message', () => {
    const source = dedent`
      import { css } from 'vindur'

      const buttonStyle = css\`
        color: \${theme.primary};
      \`
    `;

    expect(() => {
      transform({
        source,
        fileAbsPath: '/src/button.ts',
        fs: emptyFs,
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /src/button.ts: Invalid interpolation used at \`... buttonStyle = css\` ... \${theme.primary}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
      loc: {
        "column": 11,
        "filename": undefined,
        "line": 4,
      }]
    `,
    );
  });

  test('should show direct usage in error message', () => {
    const source = dedent`
      import { css } from 'vindur'

      console.log(css\`color: \${obj.value};\`)
    `;

    expect(() => {
      transform({
        source,
        fileAbsPath: '/src/direct.ts',
        fs: emptyFs,
        importAliases,
      });
    }).toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /src/direct.ts: Invalid interpolation used at \`css\` ... \${obj.value}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported
      loc: {
        "column": 25,
        "filename": undefined,
        "line": 3,
      }]
    `,
    );
  });
});

describe('corner cases', () => {
  test('should handle empty css templates', () => {
    const source = dedent`
      import { css } from 'vindur'

      const style = css\`\`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/empty.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`""`);

    expect(result.code).toMatchInlineSnapshot(`"const style = "v1v2q6wl-1";"`);
  });

  test('should handle css with only whitespace', () => {
    const source = dedent`
      import { css } from 'vindur'

      const style = css\`
  
  
      \`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/whitespace.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`""`);

    expect(result.code).toMatchInlineSnapshot(`"const style = "vngi9r6-1";"`);
  });

  test('should handle multiple css declarations in one file', () => {
    const source = dedent`
      import { css } from 'vindur'

      const style1 = css\`color: red;\`
      const style2 = css\`color: blue;\`
      const style3 = css\`color: green;\`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/multiple.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1m1fhxk-1 {
        color: red;
      }

      .v1m1fhxk-2 {
        color: blue;
      }

      .v1m1fhxk-3 {
        color: green;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const style1 = "v1m1fhxk-1";
      const style2 = "v1m1fhxk-2";
      const style3 = "v1m1fhxk-3";"
    `);
  });

  test('should handle css with special characters and escapes', () => {
    const source = dedent`
      import { css } from 'vindur'

      const style = css\`
        content: "quotes \\"with\\" escapes";
        background: url('image.png');
        font-family: 'Font Name', sans-serif;
      \`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/special.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".viwoa2i-1 {
        content: "quotes \\"with\\" escapes";
        background: url('image.png');
        font-family: 'Font Name', sans-serif;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`"const style = "viwoa2i-1";"`);
  });

  test('should resolve variables at different positions in CSS', () => {
    const source = dedent`
      import { css } from 'vindur'

      const property = 'color'
      const value = 'red'
      const unit = 'px'

      const style = css\`
        \${property}: \${value};
        font-size: 16\${unit};
      \`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/positions.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vjenap5-1 {
        color: red;
        font-size: 16px;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const property = 'color';
      const value = 'red';
      const unit = 'px';
      const style = "vjenap5-1";"
    `);
  });

  test('should handle invalid css syntax gracefully', () => {
    const source = dedent`
      import { css } from 'vindur'

      const style = css\`
        color: ;
        font-size;
        background: red blue green yellow orange;
      \`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/invalid.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vidwcaw-1 {
        color: ;
        font-size;
        background: red blue green yellow orange;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`"const style = "vidwcaw-1";"`);
  });

  test('should handle very long css content', () => {
    const longStyles = Array(100).fill('margin: 1px;').join('\n  ');
    const source = dedent`
      import { css } from 'vindur'

      const style = css\`
        ${longStyles}
      \`
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/long.ts',
      fs: emptyFs,
      importAliases,
    });

    // Should contain the generated class name pattern and margin styles
    expect(result.css).toMatch(CLASS_PATTERN_REGEX);
    expect(result.css).toContain('margin: 1px;');
    expect(result.code).toMatch(CLASS_NAME_REGEX);
  });

  test('should handle direct css usage without assignment', () => {
    const source = dedent`
      import { css } from 'vindur'

      console.log(css\`color: red;\`)
    `;

    const result = transform({
      source,
      fileAbsPath: '/src/direct.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1w3db20-1 {
        color: red;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`"console.log("v1w3db20-1");"`);
  });
});
