import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from './testUtils';

describe('Style Flags Warning System', () => {
  describe('Missing Boolean Modifier Styles', () => {
    test('should warn for single missing boolean selector', async () => {
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
        dev: true,
      });

      expect(result.code).toContain('console.warn');
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.active" in Button',
      );
    });

    test('should warn for multiple missing boolean selectors', async () => {
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
        dev: true,
      });

      expect(result.code).toContain('console.warn');
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.featured" in Card',
      );
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.highlighted" in Card',
      );
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.collapsed" in Card',
      );
    });
  });

  describe('Missing String Union Modifier Styles', () => {
    test('should warn for missing string union selectors', async () => {
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
        dev: true,
      });

      expect(result.code).toContain('console.warn');
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.size-small" in Button',
      );
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.size-large" in Button',
      );
    });

    test('should warn for partially missing string union selectors', async () => {
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
        dev: true,
      });

      expect(result.code).toContain('console.warn');
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.variant-secondary" in Widget',
      );
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.variant-danger" in Widget',
      );
      // Should NOT warn for variant-primary since it exists
      expect(result.code).not.toContain(
        'Warning: Missing modifier styles for "&.variant-primary"',
      );
    });

    test('should warn for multiple string union props with missing selectors', async () => {
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
        dev: true,
      });

      expect(result.code).toContain('console.warn');
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.size-small" in Component',
      );
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.size-large" in Component',
      );
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.theme-light" in Component',
      );
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.theme-dark" in Component',
      );
    });
  });

  describe('Mixed Boolean and String Union Missing Styles', () => {
    test('should warn for mixed missing selectors', async () => {
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
        dev: true,
      });

      expect(result.code).toContain('console.warn');

      // Should warn for missing selectors
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.disabled" in ComplexButton',
      );
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.size-large" in ComplexButton',
      );
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.variant-primary" in ComplexButton',
      );
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.variant-secondary" in ComplexButton',
      );

      // Should NOT warn for present selectors
      expect(result.code).not.toContain(
        'Warning: Missing modifier styles for "&.active"',
      );
      expect(result.code).not.toContain(
        'Warning: Missing modifier styles for "&.size-small"',
      );
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

      const devResult = await transformWithFormat({
        source: sourceCode,
        dev: true,
      });

      const prodResult = await transformWithFormat({
        source: sourceCode,
        dev: false,
      });

      // Dev mode should have warnings
      expect(devResult.code).toContain('console.warn');
      expect(devResult.code).toContain('Missing modifier styles');

      // Production mode should NOT have warnings
      expect(prodResult.code).not.toContain('console.warn');
      expect(prodResult.code).not.toContain('Missing modifier styles');
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
        dev: true,
      });

      // Should NOT contain any warnings
      expect(result.code).not.toContain('console.warn');
      expect(result.code).not.toContain('Missing modifier styles');
    });
  });

  describe('Edge Cases', () => {
    test('should handle components with no style flags gracefully', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { styled } from 'vindur';

          const SimpleButton = styled.button\`
            padding: 8px 16px;
            background: blue;
          \`;
        `,
        dev: true,
      });

      // Should not contain warnings for components without style flags
      expect(result.code).not.toContain('console.warn');
      expect(result.code).not.toContain('Missing modifier styles');
    });

    test('should handle complex selectors and nested styles', async () => {
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
        dev: true,
      });

      expect(result.code).toContain('console.warn');
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.highlighted" in Card',
      );
    });

    test('should handle hashed selectors in CSS correctly', async () => {
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
        dev: true,
      });

      // Should NOT warn because the selector exists
      expect(result.code).not.toContain('console.warn');
      expect(result.code).not.toContain('Missing modifier styles');
    });
  });
});
