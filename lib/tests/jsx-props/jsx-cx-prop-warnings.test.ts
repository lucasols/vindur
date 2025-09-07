import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { describe, expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('Warnings for Missing CSS Classes', () => {
  test('should warn about cx modifiers without corresponding CSS classes in dev mode', async () => {
    const warnings: TransformWarning[] = [];

    const result = await transformWithFormat({
      source: dedent`
        import { styled, cx } from 'vindur';

        const Card = styled.div\`
          background: white;
          padding: 16px;

          &.active {
            background: blue;
          }

          &.disabled {
            opacity: 0.5;
          }
        \`;

        function Component({ isActive, isDisabled, isHighlighted }) {
          return (
            <Card cx={{ active: isActive, disabled: isDisabled, highlighted: isHighlighted }}>
              Content
            </Card>
          );
        }
      `,
      onWarning: (warning) => {
        warnings.push(warning);
      },
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      - TransformWarning#:
          message: 'Warning: Missing CSS classes for cx modifiers in Card: highlighted'
          loc: 'current_file:18:4'
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { cx } from "vindur";
      function Component({ isActive, isDisabled, isHighlighted }) {
        return (
          <div
            className={
              "v1560qbr-1-Card " +
              cx({
                "v1560qbr-2-active": isActive,
                "v1560qbr-3-disabled": isDisabled,
                "v1560qbr-4-highlighted": isHighlighted,
              })
            }
          >
            Content
          </div>
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Card {
        background: white;
        padding: 16px;

        &.v1560qbr-2-active {
          background: blue;
        }

        &.v1560qbr-3-disabled {
          opacity: 0.5;
        }
      }
      "
    `);
  });

  test('should warn about multiple cx modifiers without corresponding CSS classes in dev mode', async () => {
    const warnings: TransformWarning[] = [];

    const result = await transformWithFormat({
      source: dedent`
        import { styled, cx } from 'vindur';

        const Widget = styled.div\`
          background: white;

          &.active {
            background: blue;
          }
        \`;

        function Component({ isActive, isDisabled, isHighlighted, isCompact }) {
          return (
            <Widget cx={{ active: isActive, disabled: isDisabled, highlighted: isHighlighted, compact: isCompact }}>
              Content
            </Widget>
          );
        }
      `,
      onWarning: (warning) => {
        warnings.push(warning);
      },
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      - TransformWarning#:
          message: 'Warning: Missing CSS classes for cx modifiers in Widget: disabled, highlighted, compact'
          loc: 'current_file:13:4'
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { cx } from "vindur";
      function Component({ isActive, isDisabled, isHighlighted, isCompact }) {
        return (
          <div
            className={
              "v1560qbr-1-Widget " +
              cx({
                "v1560qbr-2-active": isActive,
                "v1560qbr-3-disabled": isDisabled,
                "v1560qbr-4-highlighted": isHighlighted,
                "v1560qbr-5-compact": isCompact,
              })
            }
          >
            Content
          </div>
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Widget {
        background: white;

        &.v1560qbr-2-active {
          background: blue;
        }
      }
      "
    `);
  });

  test('should not warn in production mode', async () => {
    const warnings: TransformWarning[] = [];
    const result = await transformWithFormat({
      source: dedent`
        import { styled, cx } from 'vindur';

        const Card = styled.div\`
          background: white;

          &.active {
            background: blue;
          }
        \`;

        function Component({ isActive, isHighlighted }) {
          return (
            <Card cx={{ active: isActive, highlighted: isHighlighted }}>
              Content
            </Card>
          );
        }
      `,
      production: true,
      onWarning: (warning) => {
        warnings.push(warning);
      },
    });

    expect(warnings).toHaveLength(0);
    expect(result.code).toMatchInlineSnapshot(`
      "import { cx } from "vindur";
      function Component({ isActive, isHighlighted }) {
        return (
          <div
            className={
              "v1560qbr-1 " +
              cx({
                "v1560qbr-2": isActive,
                "v1560qbr-3": isHighlighted,
              })
            }
          >
            Content
          </div>
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: white;

        &.v1560qbr-2 {
          background: blue;
        }
      }
      "
    `);
  });

  test('should not warn when all cx modifiers have corresponding CSS classes', async () => {
    const warnings: TransformWarning[] = [];
    const result = await transformWithFormat({
      source: dedent`
        import { styled, cx } from 'vindur';

        const Button = styled.button\`
          padding: 8px;

          &.primary {
            background: blue;
          }

          &.disabled {
            opacity: 0.5;
          }
        \`;

        function Component({ isPrimary, isDisabled }) {
          return (
            <Button cx={{ primary: isPrimary, disabled: isDisabled }}>
              Click me
            </Button>
          );
        }
      `,
      onWarning: (warning) => {
        warnings.push(warning);
      },
    });

    expect(warnings).toHaveLength(0);
    expect(result.code).toMatchInlineSnapshot(`
      "import { cx } from "vindur";
      function Component({ isPrimary, isDisabled }) {
        return (
          <button
            className={
              "v1560qbr-1-Button " +
              cx({
                "v1560qbr-2-primary": isPrimary,
                "v1560qbr-3-disabled": isDisabled,
              })
            }
          >
            Click me
          </button>
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        padding: 8px;

        &.v1560qbr-2-primary {
          background: blue;
        }

        &.v1560qbr-3-disabled {
          opacity: 0.5;
        }
      }
      "
    `);
  });

  test('should exclude $ prefixed props from missing CSS class checking', async () => {
    const warnings: TransformWarning[] = [];

    const result = await transformWithFormat({
      source: dedent`
        import { styled, cx } from 'vindur';

        const Widget = styled.div\`
          padding: 10px;

          &.active {
            background: blue;
          }
        \`;

        function Component({ isActive, hasError, hasWarning }) {
          return <Widget cx={{ active: isActive, $error: hasError, warning: hasWarning }} />;
        }
      `,
      onWarning: (warning) => {
        warnings.push(warning);
      },
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      - TransformWarning#:
          message: 'Warning: Missing CSS classes for cx modifiers in Widget: warning'
          loc: 'current_file:12:9'
      "
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "import { cx } from "vindur";
      function Component({ isActive, hasError, hasWarning }) {
        return (
          <div
            className={
              "v1560qbr-1-Widget " +
              cx({
                "v1560qbr-2-active": isActive,
                error: hasError,
                "v1560qbr-3-warning": hasWarning,
              })
            }
          />
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Widget {
        padding: 10px;

        &.v1560qbr-2-active {
          background: blue;
        }
      }
      "
    `);
  });

  test('should not warn when $ prefixed props have corresponding CSS classes', async () => {
    const warnings: TransformWarning[] = [];
    const result = await transformWithFormat({
      source: dedent`
        import { styled, cx } from 'vindur';

        const Widget = styled.div\`
          padding: 10px;

          &.active {
            background: blue;
          }

          &.error {
            color: red;
          }

          &.disabled {
            opacity: 0.5;
          }
        \`;

        function Component({ isActive, hasError, isDisabled }) {
          return <Widget cx={{ active: isActive, $error: hasError, $disabled: isDisabled }} />;
        }
      `,
      onWarning: (warning) => {
        warnings.push(warning);
      },
    });

    expect(warnings).toHaveLength(0);
    expect(result.code).toMatchInlineSnapshot(`
      "import { cx } from "vindur";
      function Component({ isActive, hasError, isDisabled }) {
        return (
          <div
            className={
              "v1560qbr-1-Widget " +
              cx({
                "v1560qbr-2-active": isActive,
                error: hasError,
                disabled: isDisabled,
              })
            }
          />
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Widget {
        padding: 10px;

        &.v1560qbr-2-active {
          background: blue;
        }

        &.error {
          color: red;
        }

        &.disabled {
          opacity: 0.5;
        }
      }
      "
    `);
  });

  test('reproduce bug', async () => {
    const warnings: TransformWarning[] = [];

    const result = await transformWithFormat({
      source: dedent`
        import { styled, cx } from 'vindur';
        import { ButtonElement } from '#/button';
        import { colors } from '#/colors';
        import { transition } from '#/transitions';


        const FilterButton = styled(ButtonElement)\`
          display: block;
          width: 100%;
          padding: 6px 0;
          height: 36px;
          border: none;
          background: transparent;
          color: \${colors.deprecated_text.var};
          text-align: left;
          cursor: pointer;
          font-size: 16px;
          letter-spacing: 0.04em;
          opacity: 0.7;
          \${transition()};

          &.active {
            color: \${colors.lime.var};
            opacity: 1;
          }

          &:hover {
            opacity: 1;
          }
        \`;

        function Component({ isActive }) {
          return<>
           <FilterButton
              cx={{ active: activeFilter === 'blocked' }}
              onClick={() => onFilterChange('blocked')}
            >
              Blocked
            </FilterButton>

            <FilterButton
              cx={{ active: activeFilter === 'blocked' }}
              onClick={() => onFilterChange('blocked')}
            >
              Blocked
            </FilterButton>
            </>;
        }
      `,
      onWarning: (warning) => {
        warnings.push(warning);
      },
      overrideDefaultFs: createFsMock({
        'colors.ts': dedent`
          import { createStaticThemeColors } from 'vindur';

          export const colors = createStaticThemeColors({
            deprecated_text: '#F00',
            lime: '#00FF00',
          });
        `,
        'transitions.ts': dedent`
          import { css } from 'vindur';

          export const transition = vindurFn(() => \`
            transition: all 0.3s ease;
          \`);
        `,
        'button.tsx': dedent`
          import { styled } from 'vindur';

          export const ButtonElement: FC = () => <button />;
        `,
      }),
    });

    expect(warnings.length).toBe(0);

    expect(result.code).toMatchInlineSnapshot(`
      "import { cx } from "vindur";
      import { ButtonElement } from "#/button";
      import { colors } from "#/colors";
      function Component({ isActive }) {
        return (
          <>
            <ButtonElement
              onClick={() => onFilterChange("blocked")}
              className={
                "v1560qbr-1-FilterButton " +
                cx({
                  "v1560qbr-2-active": activeFilter === "blocked",
                })
              }
            >
              Blocked
            </ButtonElement>

            <ButtonElement
              onClick={() => onFilterChange("blocked")}
              className={
                "v1560qbr-1-FilterButton " +
                cx({
                  "v1560qbr-2-active": activeFilter === "blocked",
                })
              }
            >
              Blocked
            </ButtonElement>
          </>
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-FilterButton {
        display: block;
        width: 100%;
        padding: 6px 0;
        height: 36px;
        border: none;
        background: transparent;
        color: var(--stc-deprecated_text-var, #f00);
        text-align: left;
        cursor: pointer;
        font-size: 16px;
        letter-spacing: 0.04em;
        opacity: 0.7;

        transition: all 0.3s ease;

        &.v1560qbr-2-active {
          color: var(--stc-lime-var, #0f0);
          opacity: 1;
        }

        &:hover {
          opacity: 1;
        }
      }
      "
    `);
  });
});
