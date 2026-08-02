import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('CX prop index assignment according to spec', () => {
  test('should assign unique indices for each cx prop usage in dev mode', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled, cx } from 'vindur';

        // css gets index 1
        const baseStyles = css\`
          background: red;
        \`;

        // css prop gets index 2, cx prop: active gets index 3, disabled gets index 4
        const ComponentA = <div cx={{ active: isActive, disabled: isDisabled }} css={\`
          &.active { background: blue; }
          &.disabled { opacity: 0.5; }
        \`} />;

        // styled component gets index 5
        const Button = styled.button\`
          color: blue;
        \`;

        // css prop gets index 6, cx prop: active gets index 7 (unique from previous), loading gets index 8
        const ComponentB = <div cx={{ active: isActive, loading: isLoading }} css={\`
          &.active { background: green; }
          &.loading { opacity: 0.7; }
        \`} />;
      `,
      production: false,
    });

    // Check that active class gets different indices in different usages
    const activeMatches = result.code.match(/-(\d+)-active/g);
    expect(activeMatches).toHaveLength(2);
    expect(activeMatches?.[0]).not.toBe(activeMatches?.[1]); // Different indices for each usage

    // All classes should use the same file hash but different indices
    expect(result.code).toContain('v1560qbr-3-active'); // First usage (after css=1, css-prop=2)
    expect(result.code).toContain('v1560qbr-4-disabled');
    expect(result.code).toContain('v1560qbr-7-active'); // Second usage (after styled=5, css-prop=6)
    expect(result.code).toContain('v1560qbr-8-loading');
  });

  test('should assign unique indices for each cx prop usage in production mode', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled, cx } from 'vindur';

        const baseStyles = css\`
          background: red;
        \`;

        // css prop gets index 2, cx modifiers get indices 3 and 4
        const ComponentA = <div cx={{ active: isActive, disabled: isDisabled }} css={\`
          &.active { background: blue; }
          &.disabled { opacity: 0.5; }
        \`} />;

        const Button = styled.button\`
          color: blue;
        \`;

        // css prop gets index 6, cx modifiers get indices 7 and 8 (unique from previous)
        const ComponentB = <div cx={{ active: isActive, loading: isLoading }} css={\`
          &.active { background: green; }
          &.loading { opacity: 0.7; }
        \`} />;
      `,
      production: true,
    });

    // All classes should use the same file hash but different indices in production
    expect(result.code).toContain('"v1560qbr-3"'); // first active (after css=1, css-prop=2)
    expect(result.code).toContain('"v1560qbr-4"'); // disabled
    expect(result.code).toContain('"v1560qbr-7"'); // second active (after styled=5, css-prop=6)
    expect(result.code).toContain('"v1560qbr-8"'); // loading

    // Should NOT contain the className suffix in production
    expect(result.code).not.toContain('active');
    expect(result.code).not.toContain('disabled');
    expect(result.code).not.toContain('loading');

    // Check that each active usage gets a different index (no reuse)
    const v3Count = (result.code.match(/"v1560qbr-3"/g) || []).length;
    const v7Count = (result.code.match(/"v1560qbr-7"/g) || []).length;
    expect(v3Count).toBe(1); // First active usage
    expect(v7Count).toBe(1); // Second active usage
  });

  test('should reserve cx modifier indices before later styled components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Toggle = styled.div\`
          display: flex;
          &.hasSubtasks { opacity: 1; }
          &.isExpanded .icon { transform: rotate(90deg); }
        \`;

        const App = ({ hasSubtasks, isExpanded }) => (
          <Toggle cx={{ hasSubtasks, isExpanded }}>
            <span className="icon" />
          </Toggle>
        );

        const AttachmentButton = styled.button\`width: 18px;\`;
        const AttachmentImage = styled.img\`border: 1px solid cyan;\`;
      `,
      production: true,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { cx } from "vindur";
      const App = ({ hasSubtasks, isExpanded }) => (
        <div
          className={
            "v1560qbr-1 " +
            cx({
              "v1560qbr-2": hasSubtasks,
              "v1560qbr-3": isExpanded,
            })
          }
        >
          <span className="icon" />
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        display: flex;
        &.v1560qbr-2 {
          opacity: 1;
        }
        &.v1560qbr-3 .icon {
          transform: rotate(90deg);
        }
      }

      .v1560qbr-4 {
        width: 18px;
      }

      .v1560qbr-5 {
        border: 1px solid cyan;
      }
      "
    `);
  });
});
