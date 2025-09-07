import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { describe, expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

describe('Style Flags Warning System', () => {
  describe('Missing Boolean Modifier Styles', () => {
    test('should warn for single missing boolean selector', async () => {
      const warnings: TransformWarning[] = [];

      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Button = styled.button<{
            active: boolean;
          }>\`
            padding: 8px 16px;
            color: blue;
          \`;
        `,
        onWarning: (warning) => {
          warnings.push(warning);
        },
      });

      expect(compactSnapshot(warnings)).toMatchInlineSnapshot(
        `
          "
          - TransformWarning#:
              message: 'Warning: Missing modifier styles for "&.active" in Button'
              loc: 'current_file:3:6'
          "
        `,
      );
      expect(result.code).toMatchInlineSnapshot(`""`);
    });

    test('should warn for multiple missing boolean selectors', async () => {
      const warnings: TransformWarning[] = [];

      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Card = styled.div<{
            featured: boolean;
            highlighted: boolean;
            collapsed: boolean;
          }>\`
            padding: 16px;
            border: 1px solid #ddd;
          \`;
        `,
        onWarning: (warning) => {
          warnings.push(warning);
        },
      });

      expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
        "
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.featured" in Card'
            loc: 'current_file:3:6'
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.highlighted" in Card'
            loc: 'current_file:3:6'
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.collapsed" in Card'
            loc: 'current_file:3:6'
        "
      `);
      expect(result.code).toMatchInlineSnapshot(`""`);
    });
  });

  describe('Missing String Union Modifier Styles', () => {
    test('should warn for missing string union selectors', async () => {
      const warnings: TransformWarning[] = [];

      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Button = styled.button<{
            size: 'small' | 'large';
          }>\`
            padding: 8px 16px;
            color: blue;
          \`;
        `,
        onWarning: (warning) => {
          warnings.push(warning);
        },
      });

      expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
        "
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.size-small" in Button'
            loc: 'current_file:3:6'
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.size-large" in Button'
            loc: 'current_file:3:6'
        "
      `);
      expect(result.code).toMatchInlineSnapshot(`""`);
    });

    test('should warn for partially missing string union selectors', async () => {
      const warnings: TransformWarning[] = [];

      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Widget = styled.div<{
            variant: 'primary' | 'secondary' | 'danger';
          }>\`
            padding: 12px;
  
            &.variant-primary {
              background: blue;
            }
  
            /* Missing: &.variant-secondary and &.variant-danger */
          \`;
        `,
        onWarning: (warning) => {
          warnings.push(warning);
        },
      });

      expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
        "
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.variant-secondary" in Widget'
            loc: 'current_file:3:6'
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.variant-danger" in Widget'
            loc: 'current_file:3:6'
        "
      `);

      expect(result.code).toMatchInlineSnapshot(`""`);
    });

    test('should warn for multiple string union props with missing selectors', async () => {
      const warnings: TransformWarning[] = [];

      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Component = styled.div<{
            size: 'small' | 'large';
            theme: 'light' | 'dark';
          }>\`
            padding: 16px;
            /* Missing all selectors for both props */
          \`;
        `,
        onWarning: (warning) => {
          warnings.push(warning);
        },
      });

      expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
        "
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.size-small" in Component'
            loc: 'current_file:3:6'
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.size-large" in Component'
            loc: 'current_file:3:6'
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.theme-light" in Component'
            loc: 'current_file:3:6'
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.theme-dark" in Component'
            loc: 'current_file:3:6'
        "
      `);
      expect(result.code).toMatchInlineSnapshot(`""`);
    });
  });

  describe('Mixed Boolean and String Union Missing Styles', () => {
    test('should warn for mixed missing selectors', async () => {
      const warnings: TransformWarning[] = [];

      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const ComplexButton = styled.button<{
            active: boolean;
            disabled: boolean;
            size: 'small' | 'large';
            variant: 'primary' | 'secondary';
          }>\`
            padding: 8px 16px;
  
            &.active {
              transform: scale(1.05);
            }
  
            &.size-small {
              padding: 4px 8px;
            }
  
            /* Missing: disabled, size-large, variant-primary, variant-secondary */
          \`;
        `,
        onWarning: (warning) => {
          warnings.push(warning);
        },
      });

      expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
        "
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.disabled" in ComplexButton'
            loc: 'current_file:3:6'
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.size-large" in ComplexButton'
            loc: 'current_file:3:6'
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.variant-primary" in ComplexButton'
            loc: 'current_file:3:6'
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.variant-secondary" in ComplexButton'
            loc: 'current_file:3:6'
        "
      `);
      expect(result.code).toMatchInlineSnapshot(`""`);
    });
  });

  describe('Dev vs Production Mode', () => {
    test('should only warn in dev mode, not production', async () => {
      const sourceCode = dedent`
        import { styled } from 'vindur';

        const Button = styled.button<{
          active: boolean;
          size: 'small' | 'large';
        }>\`
          padding: 8px 16px;
          /* Missing all selectors */
        \`;
      `;

      const devWarnings: TransformWarning[] = [];
      const prodWarnings: TransformWarning[] = [];

      const devResult = await transformWithFormat({
        source: sourceCode,
        onWarning: (warning) => {
          devWarnings.push(warning);
        },
      });

      const prodResult = await transformWithFormat({
        source: sourceCode,
        production: true,
        onWarning: (warning) => {
          prodWarnings.push(warning);
        },
      });

      // Dev mode should have warnings
      expect(compactSnapshot(devWarnings)).toMatchInlineSnapshot(`
        "
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.active" in Button'
            loc: 'current_file:3:6'
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.size-small" in Button'
            loc: 'current_file:3:6'
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.size-large" in Button'
            loc: 'current_file:3:6'
        "
      `);
      expect(devResult.code).toMatchInlineSnapshot(`""`);

      // Production mode should NOT have warnings
      expect(prodWarnings).toHaveLength(0);
      expect(prodResult.code).toMatchInlineSnapshot(`""`);
    });
  });

  describe('No Warnings for Complete Styles', () => {
    test('should not warn when all selectors are present', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const CompleteButton = styled.button<{
            active: boolean;
            disabled: boolean;
            size: 'small' | 'large';
            variant: 'primary' | 'secondary';
          }>\`
            padding: 8px 16px;
  
            &.active {
              transform: scale(1.05);
            }
  
            &.disabled {
              opacity: 0.5;
            }
  
            &.size-small {
              padding: 4px 8px;
            }
  
            &.size-large {
              padding: 12px 24px;
            }
  
            &.variant-primary {
              background: blue;
            }
  
            &.variant-secondary {
              background: gray;
            }
          \`;
        `,
      });

      // Should NOT contain any warnings
      expect(result.code).not.toContain('console.warn');
      expect(result.code).not.toContain('Missing modifier styles');
      expect(result.code).toMatchInlineSnapshot(`""`);
    });
  });

  describe('Edge Cases', () => {
    test('should handle components with no style flags gracefully', async () => {
      const warnings: TransformWarning[] = [];
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const SimpleButton = styled.button\`
            padding: 8px 16px;
            background: blue;
          \`;
        `,
        onWarning: (warning) => {
          warnings.push(warning);
        },
      });

      // Should not contain warnings for components without style flags
      expect(warnings.length).toBe(0);
      expect(result.code).toMatchInlineSnapshot(`""`);
    });

    test('should handle complex selectors and nested styles', async () => {
      const warnings: TransformWarning[] = [];

      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Card = styled.div<{
            highlighted: boolean;
          }>\`
            padding: 16px;
  
            .header {
              font-weight: bold;
            }
  
            &:hover {
              transform: translateY(-2px);
            }
  
            /* Missing: &.highlighted selector */
          \`;
        `,
        onWarning: (warning) => {
          warnings.push(warning);
        },
      });

      expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
        "
        - TransformWarning#:
            message: 'Warning: Missing modifier styles for "&.highlighted" in Card'
            loc: 'current_file:3:6'
        "
      `);
      expect(result.code).toMatchInlineSnapshot(`""`);
    });

    test('should handle hashed selectors in CSS correctly', async () => {
      const warnings: TransformWarning[] = [];
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const Button = styled.button<{
            primary: boolean;
          }>\`
            padding: 8px 16px;
  
            /* This should be found and not trigger warning */
            &.primary {
              background: blue;
            }
          \`;
        `,
        onWarning: (warning) => {
          warnings.push(warning);
        },
      });

      // Should NOT warn because the selector exists
      expect(warnings.length).toBe(0);
      expect(result.code).toMatchInlineSnapshot(`""`);
    });
  });
});
