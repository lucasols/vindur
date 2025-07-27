import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from './testUtils';

describe('createStaticThemeColors', () => {
  test('should transform imported static theme colors usage', async () => {
    const fs = createFsMock({
      'theme.ts': dedent`
        import { createStaticThemeColors } from 'vindur'

        export const colors = createStaticThemeColors({
          primary: '#007bff',
          secondary: '#6c757d',
        })
      `,
    });

    const source = dedent`
      import { styled } from 'vindur'
      import { colors } from '#/theme'

      const Button = styled.button\`
        background: \${colors.primary.var};
        color: \${colors.primary.contrast.var};
      \`

      const Component = () => {
        return <Button>Click me</Button>;
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: fs,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return <button className="v1560qbr-1">Click me</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: #007bff;
        color: #fff;
      }"
    `);
  });

  test('should transform local static theme colors declaration', async () => {
    const source = dedent`
      import { createStaticThemeColors, styled } from 'vindur'

      const colors = createStaticThemeColors({
        primary: '#007bff',
        secondary: '#6c757d',
      })

      const Button = styled.button\`
        background: \${colors.primary.var};
        color: \${colors.primary.contrast.var};
      \`

      const Component = () => {
        return <Button>Click me</Button>;
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const colors = {
        primary: "#007bff",
        secondary: "#6c757d",
      };
      const Component = () => {
        return <button className="v1560qbr-1">Click me</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: #007bff;
        color: #fff;
      }"
    `);
  });

  test('should transform imported theme colors in dev mode with CSS variables', async () => {
    const fs = createFsMock({
      'theme.ts': dedent`
        import { createStaticThemeColors } from 'vindur'

        export const theme = createStaticThemeColors({
          primary: '#007bff',
          secondary: '#6c757d',
        })
      `,
    });

    const source = dedent`
      import { styled } from 'vindur'
      import { theme } from '#/theme'

      const Button = styled.button\`
        background: \${theme.primary.var};
        color: \${theme.primary.contrast.var};
      \`

      const Component = () => {
        return <Button>Click me</Button>;
      }
    `;

    const result = await transformWithFormat({
      source,
      dev: true,
      overrideDefaultFs: fs,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return <button className="v1560qbr-1-Button">Click me</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: var(--stc-primary-var, #007bff);
        color: var(--stc-primary-contrast-var, #fff);
      }"
    `);
  });

  test('should handle imported theme alpha color variations', async () => {
    const fs = createFsMock({
      'colors.ts': dedent`
        import { createStaticThemeColors } from 'vindur'

        export const colors = createStaticThemeColors({
          primary: '#007bff',
          danger: '#dc3545',
        })
      `,
    });

    const source = dedent`
      import { styled } from 'vindur'
      import { colors } from '#/colors'

      const Alert = styled.div\`
        background: \${colors.danger.alpha(0.1)};
        border: 1px solid \${colors.danger.alpha(0.3)};
        color: \${colors.danger.var};
      \`

      const Component = () => {
        return <Alert>Warning message</Alert>;
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: fs,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return <div className="v1560qbr-1">Warning message</div>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: #dc35451a;
        border: 1px solid #dc35454d;
        color: #dc3545;
      }"
    `);
  });

  test('should handle imported theme darker and lighter color variations', async () => {
    const fs = createFsMock({
      'theme.ts': dedent`
        import { createStaticThemeColors } from 'vindur'

        export const colors = createStaticThemeColors({
          primary: '#007bff',
        })
      `,
    });

    const source = dedent`
      import { styled } from 'vindur'
      import { colors } from '#/theme'

      const Button = styled.button\`
        background: \${colors.primary.var};
  
        &:hover {
          background: \${colors.primary.darker(0.1)};
        }
  
        &:active {
          background: \${colors.primary.darker(0.2)};
        }
  
        &:disabled {
          background: \${colors.primary.lighter(0.3)};
        }
      \`

      const Component = () => {
        return <Button>Click me</Button>;
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: fs,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return <button className="v1560qbr-1">Click me</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: #007bff;

        &:hover {
          background: #0062cc;
        }

        &:active {
          background: #004a99;
        }

        &:disabled {
          background: #99caff;
        }
      }"
    `);
  });

  test('should handle contrast color variations', async () => {
    const source = dedent`
      import { createStaticThemeColors, styled } from 'vindur'

      const colors = createStaticThemeColors({
        primary: '#007bff',
        light: '#f8f9fa',
      })

      const Button = styled.button\`
        background: \${colors.primary.var};
        color: \${colors.primary.contrast.var};
        border: 1px solid \${colors.primary.contrast.alpha(0.2)};
  
        &.light {
          background: \${colors.light.var};
          color: \${colors.light.contrast.optimal({ saturation: 0.8 })};
        }
      \`

      const Component = () => {
        return <Button>Click me</Button>;
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const colors = {
        primary: "#007bff",
        light: "#f8f9fa",
      };
      const Component = () => {
        return <button className="v1560qbr-1">Click me</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: #007bff;
        color: #fff;
        border: 1px solid #fff3;

        &.light {
          background: #f8f9fa;
          color: #1a1a1a;
        }
      }"
    `);
  });

  test('should handle multiple imported theme color objects', async () => {
    const fs = createFsMock({
      'brand-colors.ts': dedent`
        import { createStaticThemeColors } from 'vindur'

        export const brandColors = createStaticThemeColors({
          primary: '#007bff',
          secondary: '#6c757d',
        })
      `,
      'status-colors.ts': dedent`
        import { createStaticThemeColors } from 'vindur'

        export const statusColors = createStaticThemeColors({
          success: '#28a745',
          danger: '#dc3545',
        })
      `,
    });

    const source = dedent`
      import { styled } from 'vindur'
      import { brandColors } from '#/brand-colors'
      import { statusColors } from '#/status-colors'

      const SuccessButton = styled.button\`
        background: \${statusColors.success.var};
        color: \${statusColors.success.contrast.var};
      \`

      const PrimaryButton = styled.button\`
        background: \${brandColors.primary.var};
        color: \${brandColors.primary.contrast.var};
      \`

      const Component = () => {
        return (
          <div>
            <SuccessButton>Success</SuccessButton>
            <PrimaryButton>Primary</PrimaryButton>
          </div>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: fs,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return (
          <div>
            <button className="v1560qbr-1">Success</button>
            <button className="v1560qbr-2">Primary</button>
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: #28a745;
        color: #fff;
      }

      .v1560qbr-2 {
        background: #007bff;
        color: #fff;
      }"
    `);
  });

  test('should handle imported theme colors in CSS function', async () => {
    const fs = createFsMock({
      'colors.ts': dedent`
        import { createStaticThemeColors } from 'vindur'

        export const colors = createStaticThemeColors({
          primary: '#007bff',
          warning: '#ffc107',
        })
      `,
    });

    const source = dedent`
      import { css } from 'vindur'
      import { colors } from '#/colors'

      const buttonStyles = css\`
        padding: 12px 24px;
        border: none;
        border-radius: 4px;
        background: \${colors.primary.var};
        color: \${colors.primary.contrast.var};
  
        &.warning {
          background: \${colors.warning.var};
          color: \${colors.warning.contrast.var};
        }
      \`

      const Component = () => {
        return <button className={buttonStyles}>Click me</button>;
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: fs,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const buttonStyles = "v1560qbr-1";
      const Component = () => {
        return <button className={buttonStyles}>Click me</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        padding: 12px 24px;
        border: none;
        border-radius: 4px;
        background: #007bff;
        color: #fff;

        &.warning {
          background: #ffc107;
          color: #000;
        }
      }"
    `);
  });

  test('should handle imported theme nested property access patterns', async () => {
    const fs = createFsMock({
      'theme.ts': dedent`
        import { createStaticThemeColors } from 'vindur'

        export const theme = createStaticThemeColors({
          primary: '#007bff',
        })
      `,
    });

    const source = dedent`
      import { styled } from 'vindur'
      import { theme } from '#/theme'

      const Card = styled.div\`
        border: 1px solid \${theme.primary.alpha(0.2)};
  
        &:hover {
          box-shadow: 0 4px 8px \${theme.primary.alpha(0.15)};
        }
  
        .header {
          background: \${theme.primary.lighter(0.4)};
          color: \${theme.primary.contrast.alpha(0.8)};
        }
      \`

      const Component = () => {
        return (
          <Card>
            <div className="header">Header</div>
            Content
          </Card>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: fs,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return (
          <div className="v1560qbr-1">
            <div className="header">Header</div>
            Content
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        border: 1px solid #007bff33;

        &:hover {
          box-shadow: 0 4px 8px #007bff26;
        }

        .header {
          background: #cce5ff;
          color: #fffc;
        }
      }"
    `);
  });

  test('should handle imported theme dev mode with CSS variables for complex expressions', async () => {
    const fs = createFsMock({
      'colors.ts': dedent`
        import { createStaticThemeColors } from 'vindur'

        export const colors = createStaticThemeColors({
          primary: '#007bff',
          secondary: '#6c757d',
        })
      `,
    });

    const source = dedent`
      import { styled } from 'vindur'
      import { colors } from '#/colors'

      const Button = styled.button\`
        background: \${colors.primary.var};
        color: \${colors.primary.contrast.var};
  
        &:hover {
          background: \${colors.primary.darker(0.1)};
          box-shadow: 0 2px 4px \${colors.primary.alpha(0.3)};
        }
  
        &:disabled {
          background: \${colors.secondary.lighter(0.2)};
          color: \${colors.secondary.contrast.alpha(0.5)};
        }
      \`

      const Component = () => {
        return <Button>Click me</Button>;
      }
    `;

    const result = await transformWithFormat({
      source,
      dev: true,
      overrideDefaultFs: fs,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return <button className="v1560qbr-1-Button">Click me</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: var(--stc-primary-var, #007bff);
        color: var(--stc-primary-contrast-var, #fff);

        &:hover {
          background: var(--stc-primary-darker-0\\.1, #0062cc);
          box-shadow: 0 2px 4px var(--stc-primary-alpha-0\\.3, #007bff4d);
        }

        &:disabled {
          background: var(--stc-secondary-lighter-0\\.2, #a1a8ae);
          color: var(--stc-secondary-contrast-alpha-0\\.5, #ffffff80);
        }
      }"
    `);
  });

  describe('minified color output', () => {
    test('should output minified hex colors for alpha values', async () => {
      const source = dedent`
        import { createStaticThemeColors, styled } from 'vindur'

        const colors = createStaticThemeColors({
          white: '#ffffff',
          black: '#000000',
          red: '#ff0000',
        })

        const Component = styled.div\`
          background: \${colors.white.alpha(0.2)};
          border: 1px solid \${colors.red.alpha(0.5)};
          color: \${colors.black.alpha(0.8)};
          box-shadow: 0 2px 4px \${colors.white.alpha(0.1)};
        \`
      `;

      const result = await transformWithFormat({ source });

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1 {
          background: #fff3;
          border: 1px solid #ff000080;
          color: #000c;
          box-shadow: 0 2px 4px #ffffff1a;
        }"
      `);
    });

    test('should output minified 3-character hex codes for .var properties', async () => {
      const source = dedent`
        import { createStaticThemeColors, styled } from 'vindur'

        const colors = createStaticThemeColors({
          red: '#ff0000',
          green: '#00ff00',
          blue: '#0000ff',
          white: '#ffffff',
          black: '#000000',
        })

        const Component = styled.div\`
          color: \${colors.red.var};
          background: \${colors.green.var};
          border-color: \${colors.blue.var};
          outline-color: \${colors.white.var};
          text-shadow: 1px 1px \${colors.black.var};
        \`
      `;

      const result = await transformWithFormat({ source });

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1 {
          color: #f00;
          background: #0f0;
          border-color: #00f;
          outline-color: #fff;
          text-shadow: 1px 1px #000;
        }"
      `);
    });

    test('should minify contrast colors', async () => {
      const source = dedent`
        import { createStaticThemeColors, styled } from 'vindur'

        const colors = createStaticThemeColors({
          primary: '#007bff',
          light: '#ffffff',
        })

        const Component = styled.div\`
          color: \${colors.primary.contrast.var};
          background: \${colors.light.contrast.var};
          border: 1px solid \${colors.primary.contrast.alpha(0.2)};
        \`
      `;

      const result = await transformWithFormat({ source });

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1 {
          color: #fff;
          background: #1a1a1a;
          border: 1px solid #fff3;
        }"
      `);
    });

    test('should minify darker and lighter colors', async () => {
      const source = dedent`
        import { createStaticThemeColors, styled } from 'vindur'

        const colors = createStaticThemeColors({
          primary: '#007bff',
          secondary: '#ff0000',
        })

        const Component = styled.div\`
          background: \${colors.primary.darker(0.1)};
          color: \${colors.secondary.lighter(0.2)};
        \`
      `;

      const result = await transformWithFormat({ source });

      expect(result.css).toMatchInlineSnapshot(`
        ".v1560qbr-1 {
          background: #0062cc;
          color: #f66;
        }"
      `);
    });
  });

  describe('validation', () => {
    test('should validate that theme colors are valid hex colors without alpha', async () => {
      const invalidColorCases = [
        { color: 'red', name: 'named color' },
        { color: '#ff000080', name: 'hex with alpha' },
        { color: '#ff00', name: 'invalid hex length' },
        { color: 'rgb(255, 0, 0)', name: 'rgb color' },
        { color: '#gggggg', name: 'invalid hex characters' },
        { color: 'ff0000', name: 'hex without hash' },
      ];

      for (const { color } of invalidColorCases) {
        const source = dedent`
          import { createStaticThemeColors } from 'vindur'

          const colors = createStaticThemeColors({
            invalid: '${color}',
          })
        `;

        await expect(transformWithFormat({ source })).rejects.toThrow(
          `Invalid color "${color}" for "invalid". Theme colors must be valid hex colors without alpha`,
        );
      }
    });

    test('should accept valid hex colors', async () => {
      const validColorCases = [
        '#ff0000',
        '#FF0000',
        '#f00',
        '#F00',
        '#123456',
        '#abc',
      ];

      for (const color of validColorCases) {
        const source = dedent`
          import { createStaticThemeColors } from 'vindur'

          const colors = createStaticThemeColors({
            valid: '${color}',
          })
        `;

        // Should not throw
        await expect(transformWithFormat({ source })).resolves.toBeDefined();
      }
    });
  });
});
