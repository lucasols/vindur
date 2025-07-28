import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from '@playwright/test';
import { startEnv } from '../utils/startEnv';

test.describe('keyframes', () => {
  test('should handle keyframes animations', async ({ page }) => {
    await using env = await startEnv('keyframes-basic', {
      'App.tsx': dedent`
        import { css, keyframes } from "vindur";

        const fadeIn = keyframes\`
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
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

        const fadeInClass = css\`
          animation: \${fadeIn} 0.5s ease-out;
          animation-fill-mode: both;
        \`;

        const bounceClass = css\`
          animation: \${bounce} 1s ease-in-out infinite;
          display: inline-block;
          background: #007bff;
          color: white;
          padding: 10px 20px;
          border-radius: 4px;
        \`;

        export default function App() {
          return (
            <div>
              <h1 className={fadeInClass}>Fade In Animation</h1>
              <div className={bounceClass}>Bouncing Element</div>
            </div>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const heading = page.locator('h1');
    await expect(heading).toHaveCSS('animation-fill-mode', 'both');
    await expect(heading).toHaveCSS('animation-duration', '0.5s');

    const bouncing = page.locator('div').nth(1);
    await expect(bouncing).toHaveCSS('animation-duration', '1s');
    await expect(bouncing).toHaveCSS('animation-iteration-count', 'infinite');
  });

  test('should handle keyframes with styled components', async ({ page }) => {
    await using env = await startEnv('keyframes-styled', {
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
            opacity: 1;
          }
          50% {
            transform: scale(1.1);
            opacity: 0.8;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        \`;
      `,
      'App.tsx': dedent`
        import { styled } from "vindur";
        import { rotate, pulse } from "#src/animations";

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
          color: white;
          padding: 12px 24px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          animation: \${pulse} 2s ease-in-out infinite;
        \`;

        export default function App() {
          return (
            <div>
              <Spinner />
              <PulseButton>Pulsing Button</PulseButton>
            </div>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const spinner = page.locator('div').nth(1);
    await expect(spinner).toHaveCSS('animation-duration', '1s');
    await expect(spinner).toHaveCSS('animation-timing-function', 'linear');
    await expect(spinner).toHaveCSS('border-radius', '50%');

    const button = page.locator('button');
    await expect(button).toHaveCSS('animation-duration', '2s');
    await expect(button).toHaveCSS('animation-iteration-count', 'infinite');
  });

  test('should handle complex keyframes with multiple stops', async ({
    page,
  }) => {
    await using env = await startEnv('keyframes-complex', {
      'App.tsx': dedent`
        import { css, keyframes } from "vindur";

        const rainbow = keyframes\`
          0% { background-color: red; }
          16.666% { background-color: orange; }
          33.333% { background-color: yellow; }
          50% { background-color: green; }
          66.666% { background-color: blue; }
          83.333% { background-color: indigo; }
          100% { background-color: violet; }
        \`;

        const slideIn = keyframes\`
          0% {
            transform: translateX(-100%);
            opacity: 0;
          }
          60% {
            transform: translateX(10%);
          }
          80% {
            transform: translateX(-5%);
          }
          100% {
            transform: translateX(0);
            opacity: 1;
          }
        \`;

        const rainbowClass = css\`
          animation: \${rainbow} 5s linear infinite;
          padding: 20px;
          color: white;
          font-weight: bold;
        \`;

        const slideInClass = css\`
          animation: \${slideIn} 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55);
          background: #f0f0f0;
          padding: 16px;
          margin: 16px 0;
          border-radius: 8px;
        \`;

        export default function App() {
          return (
            <div>
              <div className={rainbowClass}>Rainbow Animation</div>
              <div className={slideInClass}>Slide In with Bounce</div>
            </div>
          );
        }
      `,
    });

    await page.goto(env.baseUrl);

    const rainbow = page.locator('div').nth(1);
    await expect(rainbow).toHaveCSS('animation-duration', '5s');
    await expect(rainbow).toHaveCSS('animation-timing-function', 'linear');

    const slideIn = page.locator('div').nth(2);
    await expect(slideIn).toHaveCSS('animation-duration', '0.8s');
    await expect(slideIn).toHaveCSS(
      'animation-timing-function',
      'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
    );
  });
});
