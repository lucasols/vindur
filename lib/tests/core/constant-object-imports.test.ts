import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

test('should import simple object and use its properties in css', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { mq } from '#/media-queries'

      const style = css\`
        color: red;
        \${mq.mobile} {
          color: blue;
        }
      \`
    `,

    overrideDefaultFs: createFsMock({
      'media-queries.ts': dedent`
        export const mq = {
          mobile: '@media (max-width: 768px)',
          tablet: '@media (min-width: 769px) and (max-width: 1024px)',
          desktop: '@media (min-width: 1025px)'
        }
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const style = "v1560qbr-1-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      color: red;
      @media (max-width: 768px) {
        color: blue;
      }
    }
    "
  `);
});

test('should import object and use multiple properties in css', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { mq } from '#/media-queries'

      const style = css\`
        color: red;
        \${mq.mobile} {
          font-size: 14px;
        }
        \${mq.desktop} {
          font-size: 16px;
        }
      \`
    `,

    overrideDefaultFs: createFsMock({
      'media-queries.ts': dedent`
        export const mq = {
          mobile: '@media (max-width: 768px)',
          tablet: '@media (min-width: 769px) and (max-width: 1024px)',
          desktop: '@media (min-width: 1025px)'
        }
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const style = "v1560qbr-1-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      color: red;
      @media (max-width: 768px) {
        font-size: 14px;
      }
      @media (min-width: 1025px) {
        font-size: 16px;
      }
    }
    "
  `);
});

test('should import object and use properties in styled components', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      import { mq } from '#/media-queries'

      const Button = styled.button\`
        padding: 10px 20px;
        \${mq.mobile} {
          padding: 5px 10px;
        }
      \`

      const App = () => <Button>Click me</Button>
    `,

    overrideDefaultFs: createFsMock({
      'media-queries.ts': dedent`
        export const mq = {
          mobile: '@media (max-width: 768px)',
          tablet: '@media (min-width: 769px) and (max-width: 1024px)',
          desktop: '@media (min-width: 1025px)'
        }
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const App = () => <button className="v1560qbr-1-Button">Click me</button>;
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      padding: 10px 20px;
      @media (max-width: 768px) {
        padding: 5px 10px;
      }
    }
    "
  `);
});

test('should import object with CSS properties and use in css', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { colors } from '#/theme'

      const style = css\`
        background-color: \${colors.primary};
        color: \${colors.white};
        border: 1px solid \${colors.border};
      \`
    `,

    overrideDefaultFs: createFsMock({
      'theme.ts': dedent`
        export const colors = {
          primary: '#007bff',
          secondary: '#6c757d',
          white: '#ffffff',
          black: '#000000',
          border: '#dee2e6'
        }
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const style = "v1560qbr-1-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      background-color: #007bff;
      color: #ffffff;
      border: 1px solid #dee2e6;
    }
    "
  `);
});

test('should import multiple objects from same file', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { colors, spacing } from '#/theme'

      const style = css\`
        background: \${colors.primary};
        padding: \${spacing.large};
        margin: \${spacing.small};
      \`
    `,

    overrideDefaultFs: createFsMock({
      'theme.ts': dedent`
        export const colors = {
          primary: '#007bff',
          secondary: '#6c757d'
        }

        export const spacing = {
          small: '8px',
          medium: '16px',
          large: '24px'
        }
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const style = "v1560qbr-1-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      background: #007bff;
      padding: 24px;
      margin: 8px;
    }
    "
  `);
});

test('should work with object properties containing special characters', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { selectors } from '#/css-utils'

      const style = css\`
        \${selectors.hover} {
          color: blue;
        }
        \${selectors.focus} {
          outline: 2px solid red;
        }
      \`
    `,

    overrideDefaultFs: createFsMock({
      'css-utils.ts': dedent`
        export const selectors = {
          hover: '&:hover',
          focus: '&:focus',
          active: '&:active',
          disabled: '&:disabled'
        }
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const style = "v1560qbr-1-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      &:hover {
        color: blue;
      }
      &:focus {
        outline: 2px solid red;
      }
    }
    "
  `);
});

test('should import object and use properties in css prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { mq } from '#/media-queries'

      const App = () => (
        <div css={\`
          padding: 16px;
          background: white;
          \${mq.mobile} {
            padding: 8px;
            background: lightgray;
          }
          \${mq.desktop} {
            padding: 24px;
          }
        \`}>
          Content
        </div>
      )
    `,

    overrideDefaultFs: createFsMock({
      'media-queries.ts': dedent`
        export const mq = {
          mobile: '@media (max-width: 768px)',
          tablet: '@media (min-width: 769px) and (max-width: 1024px)',
          desktop: '@media (min-width: 1025px)'
        }
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const App = () => <div className="v1560qbr-1-css-prop-1">Content</div>;
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-css-prop-1 {
      padding: 16px;
      background: white;
      @media (max-width: 768px) {
        padding: 8px;
        background: lightgray;
      }
      @media (min-width: 1025px) {
        padding: 24px;
      }
    }
    "
  `);
});

test('should throw error for nested property access', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { theme } from '#/theme'

        const style = css\`
          color: \${theme.colors.primary};
        \`
      `,

      overrideDefaultFs: createFsMock({
        'theme.ts': dedent`
          export const theme = {
            colors: {
              primary: '#007bff',
              secondary: '#6c757d'
            }
          }
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
      [TransformError: /test.tsx: Nested property access is not supported, only one level property access is allowed at \`... style = css\` ... \${theme.colors.primary}
      loc: {
        "column": 11,
        "filename": undefined,
        "line": 5,
      }]
    `,
  );
});

test('should throw error for deeply nested property access', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { config } from '#/config'

        const style = css\`
          margin: \${config.theme.spacing.large};
        \`
      `,

      overrideDefaultFs: createFsMock({
        'config.ts': dedent`
          export const config = {
            theme: {
              spacing: {
                large: '24px'
              }
            }
          }
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
      [TransformError: /test.tsx: Nested property access is not supported, only one level property access is allowed at \`... style = css\` ... \${config.theme.spacing.large}
      loc: {
        "column": 12,
        "filename": undefined,
        "line": 5,
      }]
    `,
  );
});

test('should throw error for nested property access in styled components', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { theme } from '#/theme'

        const Button = styled.button\`
          background: \${theme.colors.primary};
        \`
      `,

      overrideDefaultFs: createFsMock({
        'theme.ts': dedent`
          export const theme = {
            colors: {
              primary: '#007bff'
            }
          }
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
      [TransformError: /test.tsx: Nested property access is not supported, only one level property access is allowed at \`... Button = styled\` ... \${theme.colors.primary}
      loc: {
        "column": 16,
        "filename": undefined,
        "line": 5,
      }]
    `,
  );
});

test('support basic interpolation and arithmetic calculations in object properties', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { mq } from '#/breakpoints'

      const style = css\`
        color: red;
  
        \${mq.mobile} {
          color: blue;
          font-size: 14px;
        }
        \${mq.desktop} {
          color: green;
          font-size: 18px;
        }
        \${mq.highDpi} {
          background-image: url('image@2x.png');
        }
      \`
    `,

    overrideDefaultFs: createFsMock({
      'breakpoints.ts': dedent`
        export const mobileThreshold = 599;

        export const mq = {
          mobile: \`@media (max-width: \${mobileThreshold}px)\`,
          desktop: \`@media (min-width: \${mobileThreshold + 1}px)\`,
          tablet: \`@media (min-width: \${mobileThreshold + 1}px) and (max-width: 1024px)\`,
          highDpi: \`@media (min-resolution: 192dpi)\`,
          print: \`@media print\`
        }
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const style = "v1560qbr-1-style";
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-style {
      color: red;

      @media (max-width: 599px) {
        color: blue;
        font-size: 14px;
      }
      @media (min-width: 600px) {
        color: green;
        font-size: 18px;
      }
      @media (min-resolution: 192dpi) {
        background-image: url("image@2x.png");
      }
    }
    "
  `);
});

test('should throw error for missing property on imported object', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { mq } from '#/breakpoints'

        const style = css\`
          color: red;
          \${mq.nonExistentBreakpoint} {
            color: blue;
          }
        \`
      `,

      overrideDefaultFs: createFsMock({
        'breakpoints.ts': dedent`
          export const mobileThreshold = 599;

          export const mq = {
            mobile: '@media (max-width: 599px)',
            desktop: '@media (min-width: 600px)'
          }
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
      [TransformError: /test.tsx: Property "nonExistentBreakpoint" not found on imported object "mq" from /breakpoints.ts
      loc: {
        "column": 4,
        "filename": undefined,
        "line": 6,
      }]
    `,
  );
});

test('should throw error for object not found in imported file', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { notExported } from '#/breakpoints'

        const style = css\`
          color: red;
          \${notExported.mobile} {
            color: blue;
          }
        \`
      `,

      overrideDefaultFs: createFsMock({
        'breakpoints.ts': dedent`
          export const mobileThreshold = 599;

          export const mq = {
            mobile: '@media (max-width: 599px)',
            desktop: '@media (min-width: 600px)'
          }
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
      [TransformError: /test.tsx: Object "notExported" not found in /breakpoints.ts
      loc: {
        "column": 4,
        "filename": undefined,
        "line": 6,
      }]
    `,
  );
});

test('should not extract objects with unresolvable template literals', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { mq } from '#/breakpoints'

        const style = css\`
          color: red;
          \${mq.mobile} {
            color: blue;
          }
        \`
      `,

      overrideDefaultFs: createFsMock({
        'breakpoints.ts': dedent`
          export const undefinedVar = 'someValue';

          export const mq = {
            mobile: \`@media (max-width: \${undefinedVariable}px)\`,
            desktop: '@media (min-width: 600px)'
          }
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
      [TransformError: /test.tsx: Object "mq" not found in /breakpoints.ts
      loc: {
        "column": 4,
        "filename": undefined,
        "line": 6,
      }]
    `,
  );
});

test('should throw error for invalid arithmetic with non-numeric values', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { spacing } from '#/constants'

        const style = css\`
          padding: \${spacing.base + spacing.unit}px;
        \`
      `,

      overrideDefaultFs: createFsMock({
        'constants.ts': dedent`
          export const spacing = {
            base: 16,
            unit: 'px' // This is a string, can't add to number
          }
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
      [TransformError: /test.tsx: Unresolved binary expression at \`... style = css\` ... \${spacing.base + spacing.unit}, only simple arithmetic with constants is supported
      loc: {
        "column": 13,
        "filename": undefined,
        "line": 5,
      }]
    `,
  );
});

test('should throw error for arithmetic with undefined imported constants', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { spacing, baseSize } from '#/constants'

        const style = css\`
          padding: \${baseSize * 2}px;
        \`
      `,

      overrideDefaultFs: createFsMock({
        'constants.ts': dedent`
          export const spacing = {
            small: 8,
            large: 24
          }
          // baseSize is not exported
        `,
      }),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
      [TransformError: /test.tsx: Unresolved binary expression at \`... style = css\` ... \${baseSize * 2}, only simple arithmetic with constants is supported
      loc: {
        "column": 13,
        "filename": undefined,
        "line": 5,
      }]
    `,
  );
});
