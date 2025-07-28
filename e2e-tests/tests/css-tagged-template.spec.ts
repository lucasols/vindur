import { expect, test } from "@playwright/test";
import { dedent } from "@ls-stack/utils/dedent";
import { startEnv } from "../utils/startEnv";

test.describe("css tagged template", () => {
  test("should handle basic styles and multiple declarations", async ({ page }) => {
    await using env = await startEnv("css-basic-multiple", {
      "App.tsx": dedent`
        import { css } from "vindur";

        const headerClass = css\`
          color: red;
          font-size: 32px;
          font-weight: bold;
        \`;

        const paragraphClass = css\`
          color: gray;
          font-size: 16px;
          line-height: 1.5;
        \`;

        export default function App() {
          return (
            <div>
              <h1 className={headerClass}>Title</h1>
              <p className={paragraphClass}>Content</p>
            </div>
          );
        }
      `,
    });

    await page.goto(env.port);
      
      const header = page.locator("h1");
      await expect(header).toHaveCSS("color", "rgb(255, 0, 0)");
      await expect(header).toHaveCSS("font-size", "32px");
      await expect(header).toHaveCSS("font-weight", "700");
      
      const paragraph = page.locator("p");
      await expect(paragraph).toHaveCSS("color", "rgb(128, 128, 128)");
      await expect(paragraph).toHaveCSS("font-size", "16px");
      await expect(paragraph).toHaveCSS("line-height", "1.5");
  });

  test("should handle pseudo-classes, pseudo-elements and hover states", async ({ page }) => {
    await using env = await startEnv("css-pseudo", {
      "App.tsx": dedent`
        import { css } from "vindur";

        const buttonClass = css\`
          background: lightblue;
          padding: 10px 20px;
          cursor: pointer;
          
          &:hover {
            background: darkblue;
            color: white;
          }
        \`;

        export default function App() {
          return <button className={buttonClass}>Click me</button>;
        }
      `,
    });

    await page.goto(env.port);
      
      const button = page.locator("button");
      await expect(button).toHaveCSS("background-color", "rgb(173, 216, 230)");
      await expect(button).toHaveCSS("padding", "10px 20px");
      
      await button.hover();
      await expect(button).toHaveCSS("background-color", "rgb(0, 0, 139)");
      await expect(button).toHaveCSS("color", "rgb(255, 255, 255)");
  });

  test("should handle media queries", async ({ page }) => {
    await using env = await startEnv("css-media", {
      "App.tsx": dedent`
        import { css } from "vindur";

        const responsiveClass = css\`
          font-size: 16px;
          
          @media (min-width: 768px) {
            font-size: 24px;
          }
          
          @media (min-width: 1024px) {
            font-size: 32px;
          }
        \`;

        export default function App() {
          return <div className={responsiveClass}>Responsive Text</div>;
        }
      `,
    });

    await page.goto(env.port);
      const element = page.locator("div").first();
      
      await page.setViewportSize({ width: 375, height: 667 });
      await expect(element).toHaveCSS("font-size", "16px");
      
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(element).toHaveCSS("font-size", "24px");
      
      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(element).toHaveCSS("font-size", "32px");
  });

  test("should handle nested selectors and child combinators", async ({ page }) => {
    await using env = await startEnv("css-nested", {
      "App.tsx": dedent`
        import { css } from "vindur";

        const containerClass = css\`
          padding: 20px;
          background: #f0f0f0;
          
          h2 {
            color: navy;
            margin-bottom: 10px;
          }
          
          p {
            color: #666;
            
            strong {
              color: black;
            }
          }
          
          > .direct-child {
            border: 1px solid #ccc;
            padding: 10px;
          }
        \`;

        export default function App() {
          return (
            <div className={containerClass}>
              <h2>Title</h2>
              <p>Text with <strong>emphasis</strong></p>
              <div className="direct-child">Direct child</div>
            </div>
          );
        }
      `,
    });

    await page.goto(env.port);
      
      const container = page.locator("div").first();
      await expect(container).toHaveCSS("padding", "20px");
      await expect(container).toHaveCSS("background-color", "rgb(240, 240, 240)");
      
      await expect(page.locator("h2")).toHaveCSS("color", "rgb(0, 0, 128)");
      await expect(page.locator("p")).toHaveCSS("color", "rgb(102, 102, 102)");
      await expect(page.locator("strong")).toHaveCSS("color", "rgb(0, 0, 0)");
      await expect(page.locator(".direct-child")).toHaveCSS("border", "1px solid rgb(204, 204, 204)");
  });
});