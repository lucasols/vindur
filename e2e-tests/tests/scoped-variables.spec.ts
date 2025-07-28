import { expect, test } from "@playwright/test";
import { dedent } from "@ls-stack/utils/dedent";
import { startEnv } from "../utils/startEnv";

test.describe("scoped css variables", () => {
  test("should handle scoped css variables", async ({ page }) => {
    await using env = await startEnv("scoped-vars-basic", {
      "App.tsx": dedent`
        import { css } from "vindur";

        const themeClass = css\`
          ---primaryColor: #007bff;
          ---secondaryColor: #6c757d;
          ---spacing: 16px;
          ---borderRadius: 4px;
        \`;

        const buttonClass = css\`
          background: var(---primaryColor);
          color: white;
          padding: var(---spacing);
          border-radius: var(---borderRadius);
          border: none;
          cursor: pointer;
          
          &:hover {
            background: var(---secondaryColor);
          }
        \`;

        const cardClass = css\`
          border: 2px solid var(---primaryColor);
          border-radius: var(---borderRadius);
          padding: var(---spacing);
          margin: var(---spacing);
        \`;

        export default function App() {
          return (
            <div className={themeClass}>
              <button className={buttonClass}>Themed Button</button>
              <div className={cardClass}>
                <h3>Card Title</h3>
                <p>Card content using scoped variables</p>
              </div>
            </div>
          );
        }
      `,
    });

    await page.goto(env.port);
    
    const button = page.locator("button");
    await expect(button).toHaveCSS("background-color", "rgb(0, 123, 255)");
    await expect(button).toHaveCSS("padding", "16px");
    await expect(button).toHaveCSS("border-radius", "4px");
    
    await button.hover();
    await expect(button).toHaveCSS("background-color", "rgb(108, 117, 125)");
    
    const card = page.locator("div").nth(2);
    await expect(card).toHaveCSS("border", "2px solid rgb(0, 123, 255)");
    await expect(card).toHaveCSS("padding", "16px");
    await expect(card).toHaveCSS("margin", "16px");
  });

  test("should handle nested scoped variables", async ({ page }) => {
    await using env = await startEnv("scoped-vars-nested", {
      "App.tsx": dedent`
        import { css } from "vindur";

        const rootTheme = css\`
          ---baseSize: 16px;
          ---primaryColor: #007bff;
          ---bgColor: #f8f9fa;
        \`;

        const darkSection = css\`
          ---bgColor: #212529;
          ---primaryColor: #0dcaf0;
          background: var(---bgColor);
          padding: calc(var(---baseSize) * 2);
        \`;

        const lightSection = css\`
          background: var(---bgColor);
          padding: calc(var(---baseSize) * 2);
        \`;

        const text = css\`
          color: var(---primaryColor);
          font-size: var(---baseSize);
          margin-bottom: var(---baseSize);
        \`;

        export default function App() {
          return (
            <div className={rootTheme}>
              <section className={lightSection}>
                <p className={text}>Light theme text</p>
              </section>
              
              <section className={darkSection}>
                <p className={text}>Dark theme text with overrides</p>
              </section>
            </div>
          );
        }
      `,
    });

    await page.goto(env.port);
    
    const lightSection = page.locator("section").first();
    await expect(lightSection).toHaveCSS("background-color", "rgb(248, 249, 250)");
    await expect(lightSection).toHaveCSS("padding", "32px");
    
    const lightText = lightSection.locator("p");
    await expect(lightText).toHaveCSS("color", "rgb(0, 123, 255)");
    await expect(lightText).toHaveCSS("font-size", "16px");
    
    const darkSection = page.locator("section").nth(1);
    await expect(darkSection).toHaveCSS("background-color", "rgb(33, 37, 41)");
    
    const darkText = darkSection.locator("p");
    await expect(darkText).toHaveCSS("color", "rgb(13, 202, 240)");
  });

  test("should handle scoped variables with styled components", async ({ page }) => {
    await using env = await startEnv("scoped-vars-styled", {
      "App.tsx": dedent`
        import { css, styled } from "vindur";

        const ThemeProvider = styled.div\`
          ---primary: #28a745;
          ---secondary: #ffc107;
          ---danger: #dc3545;
          ---spacing-sm: 8px;
          ---spacing-md: 16px;
          ---spacing-lg: 24px;
        \`;

        const Button = styled.button\`
          padding: var(---spacing-sm) var(---spacing-md);
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
        \`;

        const primaryClass = css\`
          background: var(---primary);
          color: white;
        \`;

        const secondaryClass = css\`
          background: var(---secondary);
          color: #212529;
        \`;

        const dangerClass = css\`
          background: var(---danger);
          color: white;
        \`;

        export default function App() {
          return (
            <ThemeProvider>
              <Button className={primaryClass}>Success</Button>
              <Button className={secondaryClass}>Warning</Button>
              <Button className={dangerClass}>Danger</Button>
            </ThemeProvider>
          );
        }
      `,
    });

    await page.goto(env.port);
    
    const successButton = page.locator("button").first();
    await expect(successButton).toHaveCSS("background-color", "rgb(40, 167, 69)");
    await expect(successButton).toHaveCSS("padding", "8px 16px");
    
    const warningButton = page.locator("button").nth(1);
    await expect(warningButton).toHaveCSS("background-color", "rgb(255, 193, 7)");
    await expect(warningButton).toHaveCSS("color", "rgb(33, 37, 41)");
    
    const dangerButton = page.locator("button").nth(2);
    await expect(dangerButton).toHaveCSS("background-color", "rgb(220, 53, 69)");
  });
});