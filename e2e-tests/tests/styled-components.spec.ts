import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe.configure({ mode: 'serial' });

let env: TestEnv;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  env = await startEnv('styled-components-tests', {
    'components.ts': dedent`
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

      // Test attrs functionality
      const AttrsButton = styled.button.attrs({
        type: 'button',
        'data-component': 'attrs-button',
        'aria-label': 'Styled button with attrs'
      })\`
        background: #dc3545;
        color: white;
        padding: 8px 16px;
      \`;

      const AttrsInput = styled.input.attrs({
        type: 'text',
        placeholder: 'Attrs placeholder',
        'data-testid': 'attrs-input'
      })\`
        border: 2px solid #007bff;
        padding: 6px 12px;
      \`;

      // Test withComponent functionality
      const BaseButton = styled.button\`
        background: #28a745;
        padding: 12px 24px;
        border: none;
        color: white;
      \`;

      const LinkButton = BaseButton.withComponent('a');
      const SpanButton = BaseButton.withComponent('span');

      export default function App() {
        return (
          <Container data-testid="container">
            <Title data-testid="title">Welcome</Title>
            <Button data-testid="active-button">Active</Button>
            <Button data-testid="disabled-button" disabled>Disabled</Button>

            {/* attrs tests */}
            <AttrsButton data-testid="attrs-button">Button with attrs</AttrsButton>
            <AttrsInput />

            {/* withComponent tests */}
            <BaseButton data-testid="base-button">Base Button</BaseButton>
            <LinkButton data-testid="link-button" href="#test">Link Button</LinkButton>
            <SpanButton data-testid="span-button">Span Button</SpanButton>

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
  await expect(activeButton).toHaveCSS('background-color', 'rgb(0, 123, 255)');
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
  await expect(activeItem).toHaveCSS('background-color', 'rgb(227, 242, 253)');

  const normalItem = page.getByTestId('normal-item');
  const span = normalItem.locator('span');
  await expect(span).toHaveCSS('color', 'rgb(102, 102, 102)');
});

test('should handle styled components with attrs', async () => {
  const attrsButton = page.getByTestId('attrs-button');

  // Test CSS styles
  await expect(attrsButton).toHaveCSS('background-color', 'rgb(220, 53, 69)');
  await expect(attrsButton).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(attrsButton).toHaveCSS('padding', '8px 16px');

  // Test attrs attributes
  await expect(attrsButton).toHaveAttribute('type', 'button');
  await expect(attrsButton).toHaveAttribute('data-component', 'attrs-button');
  await expect(attrsButton).toHaveAttribute(
    'aria-label',
    'Styled button with attrs',
  );

  const attrsInput = page.getByTestId('attrs-input');

  // Test CSS styles
  await expect(attrsInput).toHaveCSS('border', '2px solid rgb(0, 123, 255)');
  await expect(attrsInput).toHaveCSS('padding', '6px 12px');

  // Test attrs attributes
  await expect(attrsInput).toHaveAttribute('type', 'text');
  await expect(attrsInput).toHaveAttribute('placeholder', 'Attrs placeholder');
});

test('should handle withComponent functionality', async () => {
  const baseButton = page.getByTestId('base-button');
  const linkButton = page.getByTestId('link-button');
  const spanButton = page.getByTestId('span-button');

  // All should have the same base styles
  const expectedBgColor = 'rgb(40, 167, 69)';
  const expectedPadding = '12px 24px';
  const expectedColor = 'rgb(255, 255, 255)';

  await expect(baseButton).toHaveCSS('background-color', expectedBgColor);
  await expect(baseButton).toHaveCSS('padding', expectedPadding);
  await expect(baseButton).toHaveCSS('color', expectedColor);

  await expect(linkButton).toHaveCSS('background-color', expectedBgColor);
  await expect(linkButton).toHaveCSS('padding', expectedPadding);
  await expect(linkButton).toHaveCSS('color', expectedColor);

  await expect(spanButton).toHaveCSS('background-color', expectedBgColor);
  await expect(spanButton).toHaveCSS('padding', expectedPadding);
  await expect(spanButton).toHaveCSS('color', expectedColor);

  // Test different element types
  await expect(baseButton).toHaveRole('button');
  await expect(linkButton).toHaveRole('link');
  await expect(linkButton).toHaveAttribute('href', '#test');

  // Span doesn't have a specific role but should be a span element
  const spanTagName = await spanButton.evaluate((el) =>
    el.tagName.toLowerCase(),
  );
  expect(spanTagName).toBe('span');
});
