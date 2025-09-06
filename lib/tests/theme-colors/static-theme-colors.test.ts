import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

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
      "import { colors } from '#/theme';

      const Component = () => {
        return <button className="v1560qbr-1-Button">Click me</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: var(--stc-primary-var, #007bff);
        color: var(--stc-primary-contrast-var, #fff);
      }
      "
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
        return <button className="v1560qbr-1-Button">Click me</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: var(--stc-primary-var, #007bff);
        color: var(--stc-primary-contrast-var, #fff);
      }
      "
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
      }
      "
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
        return <div className="v1560qbr-1-Alert">Warning message</div>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Alert {
        background: var(--stc-danger-alpha-0\\.1, #dc35451a);
        border: 1px solid var(--stc-danger-alpha-0\\.3, #dc35454d);
        color: var(--stc-danger-var, #dc3545);
      }
      "
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
        return <button className="v1560qbr-1-Button">Click me</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: var(--stc-primary-var, #007bff);

        &:hover {
          background: var(--stc-primary-darker-0\\.1, #0062cc);
        }

        &:active {
          background: var(--stc-primary-darker-0\\.2, #004a99);
        }

        &:disabled {
          background: var(--stc-primary-lighter-0\\.3, #99caff);
        }
      }
      "
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
        return <button className="v1560qbr-1-Button">Click me</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: var(--stc-primary-var, #007bff);
        color: var(--stc-primary-contrast-var, #fff);
        border: 1px solid var(--stc-primary-contrast-alpha-0\\.2, #fff3);

        &.light {
          background: var(--stc-light-var, #f8f9fa);
          color: var(--stc-light-contrast-optimal, #000);
        }
      }
      "
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
            <button className="v1560qbr-1-SuccessButton">Success</button>
            <button className="v1560qbr-2-PrimaryButton">Primary</button>
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-SuccessButton {
        background: var(--stc-success-var, #28a745);
        color: var(--stc-success-contrast-var, #fff);
      }

      .v1560qbr-2-PrimaryButton {
        background: var(--stc-primary-var, #007bff);
        color: var(--stc-primary-contrast-var, #fff);
      }
      "
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
      "const buttonStyles = "v1560qbr-1-buttonStyles";
      const Component = () => {
        return <button className={buttonStyles}>Click me</button>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-buttonStyles {
        padding: 12px 24px;
        border: none;
        border-radius: 4px;
        background: var(--stc-primary-var, #007bff);
        color: var(--stc-primary-contrast-var, #fff);

        &.warning {
          background: var(--stc-warning-var, #ffc107);
          color: var(--stc-warning-contrast-var, #000);
        }
      }
      "
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
          <div className="v1560qbr-1-Card">
            <div className="header">Header</div>
            Content
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        border: 1px solid var(--stc-primary-alpha-0\\.2, #007bff33);

        &:hover {
          box-shadow: 0 4px 8px var(--stc-primary-alpha-0\\.15, #007bff26);
        }

        .header {
          background: var(--stc-primary-lighter-0\\.4, #cce5ff);
          color: var(--stc-primary-contrast-alpha-0\\.8, #fffc);
        }
      }
      "
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
      }
      "
    `);
  });

  test('should transform static theme colors in production mode without CSS variables', async () => {
    const fs = createFsMock({
      'theme.ts': dedent`
        import { createStaticThemeColors } from 'vindur'

        export const colors = createStaticThemeColors({
          primary: '#007bff',
          secondary: '#6c757d',
          danger: '#dc3545',
        })
      `,
    });

    const source = dedent`
      import { styled } from 'vindur'
      import { colors } from '#/theme'

      const Button = styled.button\`
        background: \${colors.primary.var};
        color: \${colors.primary.contrast.var};
        border: 1px solid \${colors.primary.alpha(0.2)};
  
        &:hover {
          background: \${colors.primary.darker(0.1)};
        }
  
        &.danger {
          background: \${colors.danger.var};
          color: \${colors.danger.contrast.alpha(0.9)};
        }
      \`

      const Component = () => {
        return <Button>Click me</Button>;
      }
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: fs,
      production: true,
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
        border: 1px solid #007bff33;

        &:hover {
          background: #0062cc;
        }

        &.danger {
          background: #dc3545;
          color: #ffffffe6;
        }
      }
      "
    `);
  });
});
