import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from './testUtils';

describe('CX prop index assignment according to spec', () => {
  test('should assign indices according to spec example in dev mode', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled, cx } from 'vindur';

        // css gets index 1
        const baseStyles = css\`
          background: red;
        \`;

        // cx prop: active gets index 2, disabled gets index 3
        const ComponentA = <div cx={{ active: isActive, disabled: isDisabled }} />;

        // styled component gets index 4
        const Button = styled.button\`
          color: blue;
        \`;

        // cx prop: active reuses index 2, loading gets index 6 (next available)
        const ComponentB = <div cx={{ active: isActive, loading: isLoading }} />;
      `,
      production: false,
    });

    // Check that active class uses the same index in both places
    const activeMatches = result.code.match(/-(\d+)-active/g);
    expect(activeMatches).toHaveLength(2);
    expect(activeMatches?.[0]).toBe(activeMatches?.[1]); // Same index for 'active'

    // All classes should use the same file hash
    expect(result.code).toContain('v1560qbr-2-active');
    expect(result.code).toContain('v1560qbr-3-disabled');
    expect(result.code).toContain('v1560qbr-5-loading');
  });

  test('should assign indices according to spec example in production mode', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { css, styled, cx } from 'vindur';

        const baseStyles = css\`
          background: red;
        \`;

        const ComponentA = <div cx={{ active: isActive, disabled: isDisabled }} />;

        const Button = styled.button\`
          color: blue;
        \`;

        const ComponentB = <div cx={{ active: isActive, loading: isLoading }} />;
      `,
      production: true,
    });

    // All classes should use the same file hash but no class name suffix in production
    expect(result.code).toContain('"v1560qbr-2"'); // active
    expect(result.code).toContain('"v1560qbr-3"'); // disabled
    expect(result.code).toContain('"v1560qbr-5"'); // loading

    // Should NOT contain the className suffix in production
    expect(result.code).not.toContain('active');
    expect(result.code).not.toContain('disabled');
    expect(result.code).not.toContain('loading');

    // Check that v1560qbr-2 appears twice (for active in both components)
    const activeCount = (result.code.match(/"v1560qbr-2"/g) || []).length;
    expect(activeCount).toBe(2);
  });
});
