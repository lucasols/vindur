import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('Errors for Style Flag and CX Prop Conflicts', () => {
  test('should throw error when boolean style flag conflicts with cx prop key', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Button = styled.button<{ active: boolean }>\`
            padding: 8px;

            &.active {
              background: blue;
            }
          \`;

          function Component({ isActive }) {
            return (
              <Button active={isActive} cx={{ active: isActive }}>
                Click me
              </Button>
            );
          }
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: Style flag prop 'active' conflicts with cx prop key 'active' on Button. Use different names to avoid conflicts.
      loc: 13:4]
    `,
    );
  });

  test('should throw error when string union style flag conflicts with cx prop keys', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Button = styled.button<{ size: 'small' | 'large' }>\`
            padding: 8px;

            &.size-small {
              font-size: 12px;
            }

            &.size-large {
              font-size: 18px;
            }
          \`;

          function Component({ size }) {
            return (
              <Button size={size} cx={{ 'size-small': size === 'small' }}>
                Click me
              </Button>
            );
          }
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: Style flag prop 'size' conflicts with cx prop key 'size' on Button. Use different names to avoid conflicts.
      loc: 17:4]
    `,
    );
  });

  test('should throw error when multiple style flags conflict with cx prop keys', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Button = styled.button<{ active: boolean; disabled: boolean }>\`
            padding: 8px;

            &.active {
              background: blue;
            }

            &.disabled {
              opacity: 0.5;
            }
          \`;

          function Component({ isActive, isDisabled }) {
            return (
              <Button
                active={isActive}
                disabled={isDisabled}
                cx={{ active: isActive, disabled: isDisabled }}
              >
                Click me
              </Button>
            );
          }
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: Style flag props [active, disabled] conflict with cx prop keys on Button. Use different names to avoid conflicts.
      loc: 17:4]
    `,
    );
  });

  test('should not throw error when style flag and cx prop use different names', async () => {
    // Should not throw an error
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Button = styled.button<{ active: boolean }>\`
            padding: 8px;

            &.active {
              background: blue;
            }

            &.highlighted {
              border: 2px solid yellow;
            }
          \`;

          function Component({ isActive, isHighlighted }) {
            return (
              <Button active={isActive} cx={{ highlighted: isHighlighted }}>
                Click me
              </Button>
            );
          }
        `,
      }),
    ).resolves.toBeDefined();
  });

  test('should not throw error when cx prop uses $ prefixed keys', async () => {
    // Should not throw an error
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Button = styled.button<{ active: boolean }>\`
            padding: 8px;

            &.active {
              background: blue;
            }
          \`;

          function Component({ isActive, hasError }) {
            return (
              <Button active={isActive} cx={{ $active: hasError }}>
                Click me
              </Button>
            );
          }
        `,
      }),
    ).resolves.toBeDefined();
  });

  test('should throw error even in production mode', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Button = styled.button<{ active: boolean }>\`
            padding: 8px;

            &.active {
              background: blue;
            }
          \`;

          function Component({ isActive }) {
            return (
              <Button active={isActive} cx={{ active: isActive }}>
                Click me
              </Button>
            );
          }
        `,
        production: true,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: Style flag prop 'active' conflicts with cx prop key 'active' on Button. Use different names to avoid conflicts.
      loc: 13:4]
    `,
    );
  });

  test('should not throw error when there is no cx prop', async () => {
    // Should not throw an error
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Button = styled.button<{ active: boolean }>\`
            padding: 8px;

            &.active {
              background: blue;
            }
          \`;

          function Component({ isActive }) {
            return (
              <Button active={isActive}>
                Click me
              </Button>
            );
          }
        `,
      }),
    ).resolves.toBeDefined();
  });

  test('should not throw error when the duplicated name is not a style flag', async () => {
    // Should not throw an error
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled, cx } from 'vindur';

          const Button = styled.button\`
            padding: 8px;

            &.active {
              background: blue;
            }
          \`;

          function Component({ isActive }) {
            return (
              <Button active={isActive} cx={{ active: isActive }}>
                Click me
              </Button>
            );
          }
        `,
      }),
    ).resolves.toBeDefined();
  });
});
