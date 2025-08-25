import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('imported file hash generation', () => {
  test('should generate sequential indices for mixed Vindur features in single external file', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { baseStyles, fadeAnimation, primaryColor, StyledButton } from '#/components'
        import { css } from 'vindur'

        const containerStyles = css\`
          \${baseStyles};
          animation: \${fadeAnimation} 0.3s;
          color: \${primaryColor.var};
        \`

        const App = () => (
          <StyledButton 
            className={containerStyles} 
            dynamicColor={primaryColor.set('#blue')} 
          />
        )
      `,
      overrideDefaultFs: createFsMock({
        'components.ts': dedent`
          import { css, keyframes, createDynamicCssColor, styled } from 'vindur'

          export const baseStyles = css\`
            display: flex;
            align-items: center;
          \`

          export const fadeAnimation = keyframes\`
            from { opacity: 0; }
            to { opacity: 1; }
          \`

          export const primaryColor = createDynamicCssColor()

          export const StyledButton = styled.button\`
            padding: 16px;
            border-radius: 8px;
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { StyledButton } from "#/components";
      const containerStyles = "v1vylsmj-1 v1560qbr-1-containerStyles";
      const App = () => (
        <StyledButton
          className={containerStyles}
          {...primaryColor._sp("#blue", {})}
        />
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1vylsmj-1 {
        display: flex;
        align-items: center;
      }

      @keyframes v1vylsmj-2 {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .v1vylsmj-4 {
        padding: 16px;
        border-radius: 8px;
      }

      .v1560qbr-1-containerStyles {
        animation: v1vylsmj-2 0.3s;
        color: var(--v1vylsmj-3);
      }
      "
    `);
  });

  test('should handle multiple external files each with their own hash space', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { buttonStyles } from '#/styles'
        import { slideIn } from '#/animations'
        import { themeColor } from '#/colors'
        import { css } from 'vindur'

        const mainStyles = css\`
          \${buttonStyles};
          animation: \${slideIn} 0.5s;
          background: \${themeColor.var};
        \`
      `,
      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          import { css } from 'vindur'
          export const buttonStyles = css\`
            padding: 12px 24px;
            border: 1px solid #ddd;
          \`
        `,
        'animations.ts': dedent`
          import { keyframes } from 'vindur'
          export const slideIn = keyframes\`
            from { transform: translateX(-100%); }
            to { transform: translateX(0); }
          \`
        `,
        'colors.ts': dedent`
          import { createDynamicCssColor } from 'vindur'
          export const themeColor = createDynamicCssColor()
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const mainStyles = "v1s4vg6s-1 v1560qbr-1-mainStyles";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1s4vg6s-1 {
        padding: 12px 24px;
        border: 1px solid #ddd;
      }

      @keyframes v1gz5uqy-1 {
        from {
          transform: translateX(-100%);
        }
        to {
          transform: translateX(0);
        }
      }

      .v1560qbr-1-mainStyles {
        animation: v1gz5uqy-1 0.5s;
        background: var(--vip4ilp-1);
      }
      "
    `);
  });

  test('should handle styled components with proper hash generation', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { PrimaryButton, SecondaryButton } from '#/ui-components'
        import { css } from 'vindur'

        const wrapperStyles = css\`
          display: flex;
          gap: 16px;
        \`

        const App = () => (
          <div className={wrapperStyles}>
            <PrimaryButton>Primary</PrimaryButton>
            <SecondaryButton>Secondary</SecondaryButton>
          </div>
        )
      `,
      overrideDefaultFs: createFsMock({
        'ui-components.ts': dedent`
          import { styled } from 'vindur'

          export const PrimaryButton = styled.button\`
            background: #007bff;
            color: white;
            border: none;
          \`

          export const SecondaryButton = styled.button\`
            background: #6c757d;
            color: white;
            border: none;
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { PrimaryButton, SecondaryButton } from "#/ui-components";
      const wrapperStyles = "v1560qbr-1-wrapperStyles";
      const App = () => (
        <div className={wrapperStyles}>
          <PrimaryButton>Primary</PrimaryButton>
          <SecondaryButton>Secondary</SecondaryButton>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-wrapperStyles {
        display: flex;
        gap: 16px;
      }
      "
    `);
  });

  test('should handle non-exported features consuming indices correctly', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { publicColor, PublicButton } from '#/mixed-exports'
        import { css } from 'vindur'

        const styles = css\`
          color: \${publicColor.var};
        \`

        const App = () => <PublicButton className={styles} />
      `,
      overrideDefaultFs: createFsMock({
        'mixed-exports.ts': dedent`
          import { css, keyframes, createDynamicCssColor, styled } from 'vindur'

          // These should consume indices 1, 2, 3 even though not exported
          const privateStyles = css\`
            margin: 4px;
          \`

          const privateAnimation = keyframes\`
            0% { opacity: 0; }
            100% { opacity: 1; }
          \`

          const privateColor = createDynamicCssColor()

          // These should get indices 4, 5
          export const publicColor = createDynamicCssColor()

          export const PublicButton = styled.button\`
            padding: 8px;
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { PublicButton } from "#/mixed-exports";
      const styles = "v1560qbr-1-styles";
      const App = () => <PublicButton className={styles} />;
      "
    `);

    // publicColor should be index 4, PublicButton should be index 5
    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        color: var(--v1faagz9-4);
      }
      "
    `);
  });

  test('should handle dynamic colors with proper index assignment', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { primaryColor, secondaryColor } from '#/theme'
        import { css } from 'vindur'

        const styles = css\`
          color: \${primaryColor.var};
          background: \${secondaryColor.var};
        \`
      `,
      overrideDefaultFs: createFsMock({
        'theme.ts': dedent`
          import { createDynamicCssColor } from 'vindur'

          // This should get index 1
          export const primaryColor = createDynamicCssColor()

          // This should get index 2
          export const secondaryColor = createDynamicCssColor()
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-1-styles";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        color: var(--vckpm80-1);
        background: var(--vckpm80-2);
      }
      "
    `);
  });

  test('should handle complex nested imports with accurate index tracking', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { complexLayout } from '#/layouts'
        import { css } from 'vindur'

        const appStyles = css\`
          \${complexLayout};
          min-height: 100vh;
        \`
      `,
      overrideDefaultFs: createFsMock({
        'layouts.ts': dedent`
          import { css, keyframes, createDynamicCssColor, styled } from 'vindur'

          // Index 1
          const headerStyles = css\`
            height: 60px;
            background: white;
          \`

          // Index 2  
          const fadeIn = keyframes\`
            from { opacity: 0; }
            to { opacity: 1; }
          \`

          // Index 3
          const themeColor = createDynamicCssColor()

          // Index 4
          const Container = styled.div\`
            max-width: 1200px;
            margin: 0 auto;
          \`

          // Index 5 - exported as complexLayout
          export const complexLayout = css\`
            \${headerStyles};
            animation: \${fadeIn} 0.3s;
            color: \${themeColor.var};
          \`
        `,
      }),
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const appStyles = "v17amvo7-1 v17amvo7-5 v1560qbr-1-appStyles";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v17amvo7-1 {
        height: 60px;
        background: white;
      }

      @keyframes v17amvo7-2 {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .v17amvo7-4 {
        max-width: 1200px;
        margin: 0 auto;
      }

      .v17amvo7-5 {
        animation: v17amvo7-2 0.3s;
        color: var(--v17amvo7-3);
      }

      .v1560qbr-1-appStyles {
        min-height: 100vh;
      }
      "
    `);
  });
});
