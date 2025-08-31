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
      const containerStyles = "v1560qbr-1-containerStyles";
      const App = () => (
        <StyledButton
          className={containerStyles}
          {...primaryColor._sp("#blue", {})}
        />
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-containerStyles {
        display: flex;
        align-items: center;
        animation: v1vylsmj-2-fadeAnimation 0.3s;
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
      "import "#/styles";
      import "#/animations";
      const mainStyles = "v1560qbr-1-mainStyles";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-mainStyles {
        padding: 12px 24px;
        border: 1px solid #ddd;
        animation: v1gz5uqy-1-slideIn 0.5s;
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
      "import "#/layouts";
      const appStyles = "v1560qbr-1-appStyles";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-appStyles {
        height: 60px;
        background: white;
        animation: v17amvo7-2-fadeIn 0.3s;
        color: var(--v17amvo7-3);
        min-height: 100vh;
      }
      "
    `);
  });

  test('should handle cx prop with sequential hash indices', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const styles = css\`
          display: flex;
        \`

        const App = () => (
          <div 
            className={styles}
            cx={{ active: true, loading: false, disabled: true }}
          />
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { cx } from "vindur";
      const styles = "v1560qbr-1-styles";
      const App = () => (
        <div
          className={
            styles +
            " " +
            cx({
              "v1560qbr-2-active": true,
              "v1560qbr-3-loading": false,
              "v1560qbr-4-disabled": true,
            })
          }
        />
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        display: flex;
      }
      "
    `);
  });

  test('should handle css prop with proper hash generation', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const baseStyles = css\`
          padding: 8px;
        \`

        const App = () => (
          <div 
            css={\`
              color: red;
              \${baseStyles};
            \`}
          />
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const baseStyles = "v1560qbr-1-baseStyles";
      const App = () => <div className="v1560qbr-2-css-prop-2" />;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-baseStyles {
        padding: 8px;
      }

      .v1560qbr-2-css-prop-2 {
        color: red;

        padding: 8px;
      }
      "
    `);
  });

  test('should handle createGlobalStyle with hash generation', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createGlobalStyle, css } from 'vindur'

        const globalStyles = createGlobalStyle\`
          body {
            margin: 0;
            padding: 0;
          }
        \`

        const localStyles = css\`
          color: blue;
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const localStyles = "v1560qbr-1-localStyles";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      "body {
        margin: 0;
        padding: 0;
      }

      .v1560qbr-1-localStyles {
        color: blue;
      }
      "
    `);
  });

  test('should handle scoped CSS variables with hash generation', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const styles = css\`
          ---primaryColor: #007bff;
          ---fontSize: 16px;
          color: var(---primaryColor);
          font-size: var(---fontSize);
        \`

        const otherStyles = css\`
          ---spacing: 8px;
          margin: var(---spacing);
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const styles = "v1560qbr-1-styles";
      const otherStyles = "v1560qbr-4-otherStyles";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        --v1560qbr-2-primaryColor: #007bff;
        --v1560qbr-3-fontSize: 16px;
        color: var(--v1560qbr-2-primaryColor);
        font-size: var(--v1560qbr-3-fontSize);
      }

      .v1560qbr-4-otherStyles {
        --v1560qbr-5-spacing: 8px;
        margin: var(--v1560qbr-5-spacing);
      }
      "
    `);
  });

  test('should handle stableId with hash generation', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { stableId, css } from 'vindur'

        const uniqueId = stableId()
        const anotherId = stableId()

        const styles = css\`
          color: red;
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "const uniqueId = "v1560qbr-uniqueId-1";
      const anotherId = "v1560qbr-anotherId-2";
      const styles = "v1560qbr-3-styles";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-3-styles {
        color: red;
      }
      "
    `);
  });

  test('should reuse same index for identical names within file', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const App1 = () => (
          <div cx={{ $active: true, $loading: false }} />
        )

        const App2 = () => (
          <div cx={{ $active: true, $disabled: true }} />
        )

        const styles = css\`
          color: blue;
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { cx } from "vindur";
      const App1 = () => (
        <div
          className={cx({
            active: true,
            loading: false,
          })}
        />
      );
      const App2 = () => (
        <div
          className={cx({
            active: true,
            disabled: true,
          })}
        />
      );
      const styles = "v1560qbr-1-styles";
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-styles {
        color: blue;
      }
      "
    `);
  });

  test('should handle mixed direct usage with proper sequential indices', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled, keyframes, createDynamicCssColor, createGlobalStyle } from 'vindur'

        // Index 1
        const globalStyles = createGlobalStyle\`
          * { box-sizing: border-box; }
        \`

        // Index 2  
        const fadeIn = keyframes\`
          from { opacity: 0; }
          to { opacity: 1; }
        \`

        // Index 3
        const themeColor = createDynamicCssColor()

        // Index 4
        const Button = styled.button\`
          padding: 12px;
          animation: \${fadeIn} 0.3s;
          color: \${themeColor.var};
        \`

        // Index 5
        const containerStyles = css\`
          display: flex;
          gap: 16px;
        \`

        const App = () => (
          <div 
            className={containerStyles}
            cx={{ active: true }}
          >
            <Button dynamicColor={themeColor.set('#red')} />
          </div>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor, cx } from "vindur";

      // Index 1

      // Index 2
      const fadeIn = "v1560qbr-1-fadeIn";

      // Index 3
      const themeColor = createDynamicCssColor("v1560qbr-2", true);

      // Index 4

      // Index 5
      const containerStyles = "v1560qbr-4-containerStyles";
      const App = () => (
        <div
          className={
            containerStyles +
            " " +
            cx({
              "v1560qbr-5-active": true,
            })
          }
        >
          <button
            {...themeColor._sp("#red", {
              className: "v1560qbr-3-Button",
            })}
          />
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      "* {
        box-sizing: border-box;
      }

      @keyframes v1560qbr-1-fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .v1560qbr-3-Button {
        padding: 12px;
        animation: v1560qbr-1-fadeIn 0.3s;
        color: var(--v1560qbr-2);
      }

      .v1560qbr-4-containerStyles {
        display: flex;
        gap: 16px;
      }
      "
    `);
  });
});
