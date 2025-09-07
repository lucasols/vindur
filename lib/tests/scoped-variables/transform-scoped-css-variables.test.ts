import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { describe, expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

describe('scoped CSS variables', () => {
  test('should transform basic scoped variables in styled components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Card = styled.div\`
          ---primary-color: #007bff;
          ---spacing: 16px;
          ---border-radius: 8px;

          background: var(---primary-color);
          padding: var(---spacing);
          border-radius: var(---border-radius);
          border: 1px solid var(---primary-color);
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      ""
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        --v1560qbr-2-primary-color: #007bff;
        --v1560qbr-3-spacing: 16px;
        --v1560qbr-4-border-radius: 8px;

        background: var(--v1560qbr-2-primary-color);
        padding: var(--v1560qbr-3-spacing);
        border-radius: var(--v1560qbr-4-border-radius);
        border: 1px solid var(--v1560qbr-2-primary-color);
      }
      "
    `);
  });

  test('should transform scoped variables in production mode', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Card = styled.div\`
          ---primary-color: #007bff;
          ---spacing: 16px;

          background: var(---primary-color);
          padding: var(---spacing);
        \`;
      `,
      production: true,
    });

    expect(result.code).toMatchInlineSnapshot(`
      ""
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        --v1560qbr-2: #007bff;
        --v1560qbr-3: 16px;

        background: var(--v1560qbr-2);
        padding: var(--v1560qbr-3);
      }
      "
    `);
  });

  test('should handle multiple references to same scoped variable', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Button = styled.button\`
          ---button-color: red;
  
          background: var(---button-color);
          border: 1px solid var(---button-color);
  
          &:hover {
            background: var(---button-color);
            opacity: 0.8;
          }
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        --v1560qbr-2-button-color: red;

        background: var(--v1560qbr-2-button-color);
        border: 1px solid var(--v1560qbr-2-button-color);

        &:hover {
          background: var(--v1560qbr-2-button-color);
          opacity: 0.8;
        }
      }
      "
    `);
  });

  test('should handle scoped variables in css function', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur';

        const styles = css\`
          ---text-color: #333;
          ---font-size: 16px;
  
          color: var(---text-color);
          font-size: var(---font-size);
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-1-styles";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        --v1560qbr-2-text-color: #333;
        --v1560qbr-3-font-size: 16px;

        color: var(--v1560qbr-2-text-color);
        font-size: var(--v1560qbr-3-font-size);
      }
      "
    `);
  });

  test('should handle style prop transformation for scoped variables', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Card = styled.div\`
          background: var(---color);
          padding: var(---spacing);
        \`;

        const Component = () => {
          return <Card style={{ '---color': '#007bff', '---spacing': '20px' }}>Hello</Card>;
        };
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return (
          <div
            style={{
              "--v1560qbr-2-color": "#007bff",
              "--v1560qbr-3-spacing": "20px",
            }}
            className="v1560qbr-1-Card"
          >
            Hello
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        background: var(--v1560qbr-2-color);
        padding: var(--v1560qbr-3-spacing);
      }
      "
    `);
  });

  test('should handle style prop transformation in production mode', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Card = styled.div\`
          background: var(---color);
        \`;

        const Component = () => {
          return <Card style={{ '---color': '#007bff' }}>Hello</Card>;
        };
      `,
      production: true,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return (
          <div
            style={{
              "--v1560qbr-2": "#007bff",
            }}
            className="v1560qbr-1"
          >
            Hello
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: var(--v1560qbr-2);
      }
      "
    `);
  });

  test('should handle scoped variables with interpolation', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const color = '#007bff';
        const Card = styled.div\`
          ---primary: \${color};
          ---spacing: \${16}px;
  
          background: var(---primary);
          padding: var(---spacing);
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const color = "#007bff";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        --v1560qbr-2-primary: #007bff;
        --v1560qbr-3-spacing: 16px;

        background: var(--v1560qbr-2-primary);
        padding: var(--v1560qbr-3-spacing);
      }
      "
    `);
  });

  test('should handle nested selectors with scoped variables', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Card = styled.div\`
          ---card-bg: white;
          ---hover-bg: #f0f0f0;
  
          background: var(---card-bg);
  
          &:hover {
            background: var(---hover-bg);
          }
  
          .title {
            color: var(---card-bg);
          }
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        --v1560qbr-2-card-bg: white;
        --v1560qbr-3-hover-bg: #f0f0f0;

        background: var(--v1560qbr-2-card-bg);

        &:hover {
          background: var(--v1560qbr-3-hover-bg);
        }

        .title {
          color: var(--v1560qbr-2-card-bg);
        }
      }
      "
    `);
  });

  test('should handle media queries with scoped variables', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Container = styled.div\`
          ---desktop-spacing: 40px;
          ---mobile-spacing: 20px;
  
          padding: var(---desktop-spacing);
  
          @media (max-width: 768px) {
            padding: var(---mobile-spacing);
          }
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Container {
        --v1560qbr-2-desktop-spacing: 40px;
        --v1560qbr-3-mobile-spacing: 20px;

        padding: var(--v1560qbr-2-desktop-spacing);

        @media (max-width: 768px) {
          padding: var(--v1560qbr-3-mobile-spacing);
        }
      }
      "
    `);
  });

  test('should handle scoped variables in extended styled components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const BaseButton = styled.button\`
          ---base-padding: 12px 24px;
          padding: var(---base-padding);
        \`;

        const PrimaryButton = styled(BaseButton)\`
          ---primary-bg: #007bff;
          background: var(---primary-bg);
          padding: var(---base-padding);
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-BaseButton {
        --v1560qbr-2-base-padding: 12px 24px;
        padding: var(--v1560qbr-2-base-padding);
      }

      .v1560qbr-3-PrimaryButton {
        --v1560qbr-4-primary-bg: #007bff;
        background: var(--v1560qbr-4-primary-bg);
        padding: var(--v1560qbr-2-base-padding);
      }
      "
    `);
  });

  test('should handle scoped variables in global styles', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur';

        createGlobalStyle\`
          :root {
            ---global-primary: #007bff;
            ---global-font: 16px;
          }
  
          body {
            color: var(---global-primary);
            font-size: var(---global-font);
          }
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      ""
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ":root {
        --v1560qbr-2: #007bff;
        --v1560qbr-3: 16px;
      }

      body {
        color: var(--v1560qbr-2);
        font-size: var(--v1560qbr-3);
      }
      "
    `);
  });

  test('should handle scoped variables in css prop', async () => {
    const result = await transformWithFormat({
      source: dedent`
        const Component = () => {
          return (
            <div css={\`
              ---card-bg: white;
              ---card-padding: 20px;
      
              background: var(---card-bg);
              padding: var(---card-padding);
            \`}>
              Content
            </div>
          );
        };
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const Component = () => {
        return <div className="v1560qbr-1-css-prop-1">Content</div>;
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-css-prop-1 {
        --v1560qbr-2-card-bg: white;
        --v1560qbr-3-card-padding: 20px;

        background: var(--v1560qbr-2-card-bg);
        padding: var(--v1560qbr-3-card-padding);
      }
      "
    `);
  });

  test('should warn about declared but not used scoped variables', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Card = styled.div\`
          ---primary-color: #007bff;
          ---unused-color: #ff0000;
  
          background: var(---primary-color);
        \`;
      `,
      onWarning: (warning) => {
        warnings.push(warning);
      },
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      - TransformWarning#:
          message: "Scoped variable '---unused-color' is declared but never read"
          loc: 'current_file:3:6'
      "
    `);
  });

  test('should handle variables used in CSS but not declared (valid for style props)', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Card = styled.div\`
          ---primary-color: #007bff;
  
          background: var(---primary-color);
          border: 1px solid var(---theme-color);
        \`;
      `,
      onWarning: (warning) => {
        warnings.push(warning);
      },
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      - TransformWarning#:
          message: "Scoped variable '---theme-color' is used but never declared"
          loc: '/test.tsx:1:0'
      "
    `);
  });

  test('should handle complex variable names', async () => {
    const warnings: TransformWarning[] = [];
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Card = styled.div\`
          ---primary-color-light: #007bff;
          ---spacing-large-desktop: 40px;
          ---border-radius-sm: 4px;
  
          background: var(---primary-color-light);
          padding: var(---spacing-large-desktop);
          border-radius: var(---border-radius-sm);
        \`;
      `,
      onWarning: (warning) => {
        warnings.push(warning);
      },
    });

    expect(warnings).toHaveLength(0);
    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        --v1560qbr-2-primary-color-light: #007bff;
        --v1560qbr-3-spacing-large-desktop: 40px;
        --v1560qbr-4-border-radius-sm: 4px;

        background: var(--v1560qbr-2-primary-color-light);
        padding: var(--v1560qbr-3-spacing-large-desktop);
        border-radius: var(--v1560qbr-4-border-radius-sm);
      }
      "
    `);
  });

  test('should preserve regular CSS custom properties', async () => {
    const warnings: TransformWarning[] = [];
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Card = styled.div\`
          ---scoped-var: #007bff;
          --regular-var: #ff0000;
  
          background: var(---scoped-var);
          color: var(--regular-var);
          border: 1px solid var(--global-color);
        \`;
      `,
      onWarning: (warning) => {
        warnings.push(warning);
      },
    });

    expect(warnings).toHaveLength(0);
    expect(result.code).toMatchInlineSnapshot(`""`);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        --v1560qbr-2-scoped-var: #007bff;
        --regular-var: #ff0000;

        background: var(--v1560qbr-2-scoped-var);
        color: var(--regular-var);
        border: 1px solid var(--global-color);
      }
      "
    `);
  });
});
