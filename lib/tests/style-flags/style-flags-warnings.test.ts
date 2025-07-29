import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

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
      });

      expect(result.code).toContain('console.warn');
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.active" in Button',
      );
      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Button = _vCWM(
          [["active", "voctcyj-active"]],
          "v1560qbr-1-Button",
          "button",
        );
        console.warn('Warning: Missing modifier styles for "&.active" in Button');
        "
      `);
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
      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Card = _vCWM(
          [
            ["featured", "vnwmeu-featured"],
            ["highlighted", "vges7p7-highlighted"],
            ["collapsed", "v1wk07rx-collapsed"],
          ],
          "v1560qbr-1-Card",
          "div",
        );
        console.warn('Warning: Missing modifier styles for "&.collapsed" in Card');
        console.warn('Warning: Missing modifier styles for "&.highlighted" in Card');
        console.warn('Warning: Missing modifier styles for "&.featured" in Card');
        "
      `);
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
      });

      expect(result.code).toContain('console.warn');
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.size-small" in Button',
      );
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.size-large" in Button',
      );
      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Button = _vCWM([["size", "vr4ikfs-size"]], "v1560qbr-1-Button", "button");
        console.warn('Warning: Missing modifier styles for "&.size-large" in Button');
        console.warn('Warning: Missing modifier styles for "&.size-small" in Button');
        "
      `);
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
      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Widget = _vCWM(
          [["variant", "v11as9cs-variant"]],
          "v1560qbr-1-Widget",
          "div",
        );
        console.warn(
          'Warning: Missing modifier styles for "&.variant-danger" in Widget',
        );
        console.warn(
          'Warning: Missing modifier styles for "&.variant-secondary" in Widget',
        );
        "
      `);
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
      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Component = _vCWM(
          [
            ["size", "vr4ikfs-size"],
            ["theme", "v1cm7m20-theme"],
          ],
          "v1560qbr-1-Component",
          "div",
        );
        console.warn(
          'Warning: Missing modifier styles for "&.theme-dark" in Component',
        );
        console.warn(
          'Warning: Missing modifier styles for "&.theme-light" in Component',
        );
        console.warn(
          'Warning: Missing modifier styles for "&.size-large" in Component',
        );
        console.warn(
          'Warning: Missing modifier styles for "&.size-small" in Component',
        );
        "
      `);
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
      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const ComplexButton = _vCWM(
          [
            ["active", "voctcyj-active"],
            ["disabled", "v1iz0um9-disabled"],
            ["size", "vr4ikfs-size"],
            ["variant", "v11as9cs-variant"],
          ],
          "v1560qbr-1-ComplexButton",
          "button",
        );
        console.warn(
          'Warning: Missing modifier styles for "&.variant-secondary" in ComplexButton',
        );
        console.warn(
          'Warning: Missing modifier styles for "&.variant-primary" in ComplexButton',
        );
        console.warn(
          'Warning: Missing modifier styles for "&.size-large" in ComplexButton',
        );
        console.warn(
          'Warning: Missing modifier styles for "&.disabled" in ComplexButton',
        );
        "
      `);
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
      });

      const prodResult = await transformWithFormat({
        source: sourceCode,
        production: true,
      });

      // Dev mode should have warnings
      expect(devResult.code).toContain('console.warn');
      expect(devResult.code).toContain('Missing modifier styles');
      expect(devResult.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Button = _vCWM(
          [
            ["active", "voctcyj-active"],
            ["size", "vr4ikfs-size"],
          ],
          "v1560qbr-1-Button",
          "button",
        );
        console.warn('Warning: Missing modifier styles for "&.size-large" in Button');
        console.warn('Warning: Missing modifier styles for "&.size-small" in Button');
        console.warn('Warning: Missing modifier styles for "&.active" in Button');
        "
      `);

      // Production mode should NOT have warnings
      expect(prodResult.code).not.toContain('console.warn');
      expect(prodResult.code).not.toContain('Missing modifier styles');
      expect(prodResult.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Button = _vCWM(
          [
            ["active", "voctcyj"],
            ["size", "vr4ikfs"],
          ],
          "v1560qbr-1",
          "button",
        );
        "
      `);
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
      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const CompleteButton = _vCWM(
          [
            ["active", "voctcyj-active"],
            ["disabled", "v1iz0um9-disabled"],
            ["size", "vr4ikfs-size"],
            ["variant", "v11as9cs-variant"],
          ],
          "v1560qbr-1-CompleteButton",
          "button",
        );
        "
      `);
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
      });

      // Should not contain warnings for components without style flags
      expect(result.code).not.toContain('console.warn');
      expect(result.code).not.toContain('Missing modifier styles');
      expect(result.code).toMatchInlineSnapshot(`""`);
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
      });

      expect(result.code).toContain('console.warn');
      expect(result.code).toContain(
        'Warning: Missing modifier styles for "&.highlighted" in Card',
      );
      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Card = _vCWM(
          [["highlighted", "vges7p7-highlighted"]],
          "v1560qbr-1-Card",
          "div",
        );
        console.warn('Warning: Missing modifier styles for "&.highlighted" in Card');
        "
      `);
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
      });

      // Should NOT warn because the selector exists
      expect(result.code).not.toContain('console.warn');
      expect(result.code).not.toContain('Missing modifier styles');
      expect(result.code).toMatchInlineSnapshot(`
        "import { _vCWM } from "vindur";
        const Button = _vCWM(
          [["primary", "v1puiack-primary"]],
          "v1560qbr-1-Button",
          "button",
        );
        "
      `);
    });
  });
});
