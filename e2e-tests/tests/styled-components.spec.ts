import { expect, test } from "@playwright/test";
import { dedent } from "@ls-stack/utils/dedent";
import { startEnv } from "../utils/startEnv";

test.describe("styled components", () => {
  test("should handle various styled elements with hover and pseudo states", async ({ page }) => {
    await using env = await startEnv("styled-various", {
      "App.tsx": dedent`
        import { styled } from "vindur";

        const Container = styled.div\`
          max-width: 800px;
          padding: 20px;
          background-color: #f5f5f5;
        \`;

        const Button = styled.button\`
          background-color: #007bff;
          color: white;
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          
          &:hover {
            background-color: #0056b3;
          }
          
          &:disabled {
            background: #6c757d;
            cursor: not-allowed;
          }
        \`;

        const Title = styled.h1\`
          color: #333;
          font-size: 2rem;
        \`;

        const Link = styled.a\`
          color: #007bff;
          text-decoration: none;
          
          &:hover {
            text-decoration: underline;
          }
        \`;

        export default function App() {
          return (
            <Container>
              <Title>Welcome</Title>
              <Button>Active</Button>
              <Button disabled>Disabled</Button>
              <Link href="#">Learn more</Link>
            </Container>
          );
        }
      `,
    });

    await page.goto(env.port);
      
      await expect(page.locator("div").first()).toHaveCSS("background-color", "rgb(245, 245, 245)");
      await expect(page.locator("h1")).toHaveCSS("color", "rgb(51, 51, 51)");
      
      const activeButton = page.locator("button").first();
      await expect(activeButton).toHaveCSS("background-color", "rgb(0, 123, 255)");
      await activeButton.hover();
      await expect(activeButton).toHaveCSS("background-color", "rgb(0, 86, 179)");
      
      const disabledButton = page.locator("button").nth(1);
      await expect(disabledButton).toBeDisabled();
      await expect(disabledButton).toHaveCSS("background-color", "rgb(108, 117, 125)");
      await expect(disabledButton).toHaveCSS("cursor", "not-allowed");
  });

  test("should handle exported and non-exported styled components", async ({ page }) => {
    await using env = await startEnv("styled-export", {
      "components.tsx": dedent`
        import { styled } from "vindur";

        export const Button = styled.button\`
          background: #28a745;
          color: white;
          padding: 8px 16px;
          border-radius: 4px;
        \`;

        export const Input = styled.input\`
          padding: 8px 12px;
          border: 1px solid #ced4da;
          border-radius: 4px;
        \`;
      `,
      "App.tsx": dedent`
        import { styled } from "vindur";
        import { Button, Input } from "#src/components";

        const Card = styled.div\`
          background: white;
          border: 1px solid #ddd;
          padding: 16px;
          margin: 16px;
        \`;

        export default function App() {
          return (
            <Card>
              <Input placeholder="Enter text" />
              <Button>Submit</Button>
            </Card>
          );
        }
      `,
    });

    await page.goto(env.port);
      
      const card = page.locator("div").nth(1);
      await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(card).toHaveCSS("border", "1px solid rgb(221, 221, 221)");
      
      await expect(page.locator("input")).toHaveCSS("padding", "8px 12px");
      await expect(page.locator("button")).toHaveCSS("background-color", "rgb(40, 167, 69)");
  });

  test("should handle complex nested selectors", async ({ page }) => {
    await using env = await startEnv("styled-nested", {
      "App.tsx": dedent`
        import { styled } from "vindur";

        const List = styled.ul\`
          list-style: none;
          padding: 0;
          
          li {
            padding: 10px;
            border-bottom: 1px solid #eee;
            
            &:last-child {
              border-bottom: none;
            }
            
            &.active {
              background-color: #e3f2fd;
              font-weight: bold;
            }
          }
          
          li span {
            color: #666;
            font-size: 14px;
          }
        \`;

        export default function App() {
          return (
            <List>
              <li>Item 1 <span>(normal)</span></li>
              <li className="active">Item 2 <span>(active)</span></li>
              <li>Item 3 <span>(last)</span></li>
            </List>
          );
        }
      `,
    });

    await page.goto(env.port);
      
      const list = page.locator("ul");
      await expect(list).toHaveCSS("list-style", "outside none none");
      
      const activeItem = page.locator("li.active");
      await expect(activeItem).toHaveCSS("background-color", "rgb(227, 242, 253)");
      await expect(activeItem).toHaveCSS("font-weight", "700");
      
      const lastItem = page.locator("li").last();
      await expect(lastItem).toHaveCSS("border-bottom", "0px none rgb(0, 0, 0)");
      
      await expect(page.locator("li span").first()).toHaveCSS("color", "rgb(102, 102, 102)");
  });
});