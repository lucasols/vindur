import { dedent } from '@ls-stack/utils/dedent';
import { expect, test, type Page } from '@playwright/test';
import { startEnv, type TestEnv } from '../utils/startEnv';

test.describe('keyframes', () => {
  test.describe.configure({ mode: 'serial' });

  let env: TestEnv;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    env = await startEnv('keyframes-tests', {
      'animations.ts': dedent`
        import { keyframes } from "vindur";

        export const rotate = keyframes\`
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        \`;

        export const pulse = keyframes\`
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.1);
          }
          100% {
            transform: scale(1);
          }
        \`;
      `,
      'App.tsx': dedent`
        import { css, keyframes, styled } from "vindur";
        import { rotate, pulse } from "#src/animations";

        const fadeIn = keyframes\`
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        \`;

        const bounce = keyframes\`
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-20px);
          }
        \`;

        const rainbow = keyframes\`
          0% { background-color: red; }
          50% { background-color: blue; }
          100% { background-color: red; }
        \`;

        const fadeInClass = css\`
          animation: \${fadeIn} 0.5s ease-out;
        \`;

        const bounceClass = css\`
          animation: \${bounce} 1s ease-in-out infinite;
          background: #007bff;
        \`;

        const rainbowClass = css\`
          animation: \${rainbow} 5s linear infinite;
          padding: 20px;
        \`;

        const Spinner = styled.div\`
          width: 50px;
          height: 50px;
          border: 3px solid #f3f3f3;
          border-top: 3px solid #007bff;
          border-radius: 50%;
          animation: \${rotate} 1s linear infinite;
        \`;

        const PulseButton = styled.button\`
          background: #28a745;
          padding: 12px 24px;
          animation: \${pulse} 2s ease-in-out infinite;
        \`;

        export default function App() {
          return (
            <div>
              <h1 data-testid="fade-in" className={fadeInClass}>Fade In Animation</h1>
              <div data-testid="bounce" className={bounceClass}>Bouncing Element</div>
              <div data-testid="rainbow" className={rainbowClass}>Rainbow Animation</div>
              <Spinner data-testid="spinner" />
              <PulseButton data-testid="pulse-button">Pulsing Button</PulseButton>
            </div>
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

  test('should handle keyframes animations', async () => {
    const fadeIn = page.getByTestId('fade-in');
    await expect(fadeIn).toHaveCSS('animation-duration', '0.5s');

    const bounce = page.getByTestId('bounce');
    await expect(bounce).toHaveCSS('animation-duration', '1s');
    await expect(bounce).toHaveCSS('animation-iteration-count', 'infinite');
    await expect(bounce).toHaveCSS('background-color', 'rgb(0, 123, 255)');
  });

  test('should handle keyframes with styled components', async () => {
    const spinner = page.getByTestId('spinner');
    await expect(spinner).toHaveCSS('animation-duration', '1s');
    await expect(spinner).toHaveCSS('animation-timing-function', 'linear');
    await expect(spinner).toHaveCSS('border-radius', '50%');

    const button = page.getByTestId('pulse-button');
    await expect(button).toHaveCSS('animation-duration', '2s');
    await expect(button).toHaveCSS('animation-iteration-count', 'infinite');
    await expect(button).toHaveCSS('background-color', 'rgb(40, 167, 69)');
  });

  test('should handle complex keyframes with multiple stops', async () => {
    const rainbow = page.getByTestId('rainbow');
    await expect(rainbow).toHaveCSS('animation-duration', '5s');
    await expect(rainbow).toHaveCSS('animation-timing-function', 'linear');
    await expect(rainbow).toHaveCSS('padding', '20px');
  });
});
