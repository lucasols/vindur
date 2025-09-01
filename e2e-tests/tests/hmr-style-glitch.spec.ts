import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from '@playwright/test';
import { startEnv } from '../utils/startEnv';

type StyleCapture = {
  background: string;
  fontSize: string;
  timestamp: number;
};

declare global {
  interface Window {
    capturedStyles?: StyleCapture[];
    monitoringStartTime?: number;
  }
}

test('should not cause style glitches during HMR updates', async ({ page }) => {
  await using env = await startEnv('hmr-style-glitch', {
    'App.tsx': dedent`
      import { css } from "vindur";

      const boxClass = css\`
        background: red;
        color: white;
        padding: 20px;
        font-size: 16px;
        border-radius: 4px;
      \`;

      export default function App() {
        return <div data-testid="box" className={boxClass}>Test Box</div>;
      }
    `,
  });

  await page.goto(env.baseUrl);
  await page.waitForLoadState('networkidle');

  const box = page.getByTestId('box');
  await expect(box).toBeVisible({ timeout: 10000 });

  // Verify initial styles
  await expect(box).toHaveCSS('background-color', 'rgb(255, 0, 0)'); // red
  await expect(box).toHaveCSS('font-size', '16px');

  // Initialize style monitoring before triggering update
  await page.evaluate(() => {
    const element = document.querySelector('[data-testid="box"]');
    if (!element) throw new Error('Box element not found');

    window.capturedStyles = [];
    window.monitoringStartTime = Date.now();

    const captureStyles: FrameRequestCallback = () => {
      const computedStyle = window.getComputedStyle(element);
      window.capturedStyles?.push({
        background: computedStyle.backgroundColor,
        fontSize: computedStyle.fontSize,
        timestamp: Date.now() - (window.monitoringStartTime ?? 0),
      });

      if (Date.now() - (window.monitoringStartTime ?? 0) < 3000) {
        // Capture more aggressively with both requestAnimationFrame and setTimeout
        requestAnimationFrame(captureStyles);
        setTimeout(captureStyles, 1); // Capture every 1ms to catch rapid changes
      }
    };

    requestAnimationFrame(captureStyles);
  });

  // Trigger HMR update immediately while monitoring is active
  env.getFile('App.tsx').replace([
    ['background: red;', 'background: blue;'],
    ['font-size: 16px;', 'font-size: 24px;'],
  ]);

  // Trigger multiple rapid updates to increase chance of catching glitches
  await page.waitForTimeout(50);
  env.getFile('App.tsx').replace([['background: blue;', 'background: green;']]);

  await page.waitForTimeout(50);
  env
    .getFile('App.tsx')
    .replace([['background: green;', 'background: purple;']]);

  await page.waitForTimeout(50);
  env
    .getFile('App.tsx')
    .replace([['background: purple;', 'background: blue;']]);

  // Verify final styles are applied
  await expect(box).toHaveCSS('background-color', 'rgb(0, 0, 255)'); // blue
  await expect(box).toHaveCSS('font-size', '24px');

  // Get captured styles
  const capturedStyles = await page.evaluate(() => window.capturedStyles ?? []);

  // Analyze captured styles for glitches
  const uniqueBackgrounds = Array.from(
    new Set(capturedStyles.map((s) => s.background)),
  );
  const uniqueFontSizes = Array.from(
    new Set(capturedStyles.map((s) => s.fontSize)),
  );

  // Log captured values for debugging in case of failures
  if (uniqueBackgrounds.length > 3 || uniqueFontSizes.length > 3) {
    console.warn('Unique backgrounds:', uniqueBackgrounds);
    console.warn('Unique font sizes:', uniqueFontSizes);
  }

  // Should only see valid transition colors, no glitches
  // More than 5 colors might indicate glitched intermediate states
  expect(uniqueBackgrounds.length).toBeLessThanOrEqual(5);
  expect(uniqueFontSizes.length).toBe(2); // Font size only changes once

  // Verify that captured styles only contain expected values (no glitches)
  const validBackgrounds = [
    'rgb(255, 0, 0)', // red (initial)
    'rgb(0, 0, 255)', // blue
    'rgb(0, 128, 0)', // green
    'rgb(128, 0, 128)', // purple
  ];
  const validFontSizes = ['16px', '24px']; // only original and updated sizes

  // Check for specific glitch patterns (transparent backgrounds during HMR)
  const glitchDetected = capturedStyles.some(
    (style) =>
      style.background === 'rgba(0, 0, 0, 0)'
      || style.background === 'transparent'
      || style.background === '',
  );

  if (glitchDetected) {
    const glitchedStyles = capturedStyles.filter(
      (style) =>
        style.background === 'rgba(0, 0, 0, 0)'
        || style.background === 'transparent'
        || style.background === '',
    );

    console.error(
      '🐛 HMR GLITCH DETECTED: Transparent background during transitions',
    );
    console.error('Glitched samples:', glitchedStyles);

    // Fail the test to indicate glitch detection
    expect(glitchDetected).toBe(false); // This will fail when glitch is detected
  }

  // Also check for completely invalid values
  for (const style of capturedStyles) {
    if (
      !validBackgrounds.includes(style.background)
      && style.background !== 'rgba(0, 0, 0, 0)' // Known glitch pattern
      && style.background !== 'transparent'
    ) {
      console.error(
        'UNKNOWN GLITCH: Unexpected background color:',
        style.background,
        'at timestamp:',
        style.timestamp,
      );
      expect(validBackgrounds).toContain(style.background);
    }
  }

  // Ensure we captured meaningful transitions (should have initial and final colors)
  const hasInitialBackground = capturedStyles.some(
    (s) => s.background === 'rgb(255, 0, 0)', // red
  );
  const hasFinalBackground = capturedStyles.some(
    (s) => s.background === 'rgb(0, 0, 255)', // blue
  );
  const hasOldFontSize = capturedStyles.some((s) => s.fontSize === '16px');
  const hasNewFontSize = capturedStyles.some((s) => s.fontSize === '24px');

  expect(hasInitialBackground).toBe(true);
  expect(hasFinalBackground).toBe(true);
  expect(hasOldFontSize).toBe(true);
  expect(hasNewFontSize).toBe(true);

  // Log all unique backgrounds for debugging
  console.info('All captured backgrounds:', uniqueBackgrounds);
  console.info('Total samples captured:', capturedStyles.length);

  // Look for specific glitch patterns
  const hasTransparentValues = capturedStyles.some(
    (s) =>
      s.background.includes('transparent')
      || s.background.includes('rgba(0, 0, 0, 0)')
      || s.background === ''
      || s.fontSize === '',
  );

  const hasInconsistentFormats = uniqueBackgrounds.some(
    (bg) =>
      bg.startsWith('rgba(')
      && uniqueBackgrounds.some((other) => other.startsWith('rgb(')),
  );

  if (hasTransparentValues) {
    console.error('GLITCH: Found transparent/empty values during transition');
  }

  if (hasInconsistentFormats) {
    console.error('GLITCH: Inconsistent color formats (rgb vs rgba) detected');
  }

  // These might indicate glitches but aren't necessarily failures
  if (hasTransparentValues || hasInconsistentFormats) {
    console.warn('Potential HMR glitches detected - investigate further');
  }
});
