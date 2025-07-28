import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe('styled components', () => {
  test.describe.configure({ mode: 'serial' });

  let env: TestEnv;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    env = await startEnv('styled-components-tests', {
      'components.tsx': dedent`
        import { styled } from "vindur";

        export const ExportedButton = styled.button\`
          background: #28a745;
          padding: 8px 16px;
        \`;

        export const ExportedInput = styled.input\`
          padding: 8px 12px;
          border: 1px solid #ced4da;
        \`;
      `,
      'App.tsx': dedent`
        import { styled } from "vindur";
        import { ExportedButton, ExportedInput } from "#src/components";

        const Container = styled.div\`
          background-color: #f5f5f5;
          padding: 20px;
        \`;

        const Button = styled.button\`
          background-color: #007bff;
          padding: 10px 20px;
  
          &:hover {
            background-color: #0056b3;
          }
  
          &:disabled {
            background: #6c757d;
          }
        \`;

        const Title = styled.h1\`
          color: #333;
          font-size: 2rem;
        \`;

        const Card = styled.div\`
          background: white;
          border: 1px solid #ddd;
        \`;

        const List = styled.ul\`
          list-style: none;
          padding: 0;
  
          li {
            padding: 10px;
    
            &.active {
              background-color: #e3f2fd;
            }
          }
  
          li span {
            color: #666;
          }
        \`;

        export default function App() {
          return (
            <Container data-testid="container">
              <Title data-testid="title">Welcome</Title>
              <Button data-testid="active-button">Active</Button>
              <Button data-testid="disabled-button" disabled>Disabled</Button>
      
              <Card data-testid="card">
                <ExportedInput data-testid="input" placeholder="Enter text" />
                <ExportedButton data-testid="exported-button">Submit</ExportedButton>
              </Card>

              <List data-testid="list">
                <li data-testid="normal-item">Item 1 <span>(normal)</span></li>
                <li data-testid="active-item" className="active">Item 2 <span>(active)</span></li>
                <li data-testid="last-item">Item 3 <span>(last)</span></li>
              </List>
            </Container>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);
  });

  test.afterAll(async () => {
    await page.close();
    await env.cleanup();
  });

  test('should handle various styled elements with hover and pseudo states', async () => {
    const container = page.getByTestId('container');
    await expect(container).toHaveCSS('background-color', 'rgb(245, 245, 245)');

    const title = page.getByTestId('title');
    await expect(title).toHaveCSS('color', 'rgb(51, 51, 51)');
    await expect(title).toHaveCSS('font-size', '32px');

    const activeButton = page.getByTestId('active-button');
    await expect(activeButton).toHaveCSS(
      'background-color',
      'rgb(0, 123, 255)',
    );
    await activeButton.hover();
    await expect(activeButton).toHaveCSS('background-color', 'rgb(0, 86, 179)');

    const disabledButton = page.getByTestId('disabled-button');
    await expect(disabledButton).toBeDisabled();
    await expect(disabledButton).toHaveCSS(
      'background-color',
      'rgb(108, 117, 125)',
    );
  });

  test('should handle exported and non-exported styled components', async () => {
    const card = page.getByTestId('card');
    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(card).toHaveCSS('border', '1px solid rgb(221, 221, 221)');

    const input = page.getByTestId('input');
    await expect(input).toHaveCSS('padding', '8px 12px');

    const exportedButton = page.getByTestId('exported-button');
    await expect(exportedButton).toHaveCSS(
      'background-color',
      'rgb(40, 167, 69)',
    );
  });

  test('should handle complex nested selectors', async () => {
    const list = page.getByTestId('list');
    await expect(list).toHaveCSS('list-style', 'outside none none');

    const activeItem = page.getByTestId('active-item');
    await expect(activeItem).toHaveCSS(
      'background-color',
      'rgb(227, 242, 253)',
    );

    const normalItem = page.getByTestId('normal-item');
    const span = normalItem.locator('span');
    await expect(span).toHaveCSS('color', 'rgb(102, 102, 102)');
  });
});
