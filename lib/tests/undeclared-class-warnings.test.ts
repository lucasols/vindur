import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { describe, expect, test } from 'vitest';
import type { TransformWarning } from '../src/transform';
import { transformWithFormat } from './testUtils';

describe('Styled components', () => {
  test('should warn about undeclared classes in styled component without style flags', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const CheckboxContainer = styled.button\`
          opacity: 0.8;
          &:hover {
            opacity: 0.8;
            border-color: lime;
          }
          &.checked {
            background: lime;
            border-color: lime;
            opacity: 1;
          }
        \`
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      - TransformWarning#:
          message: "The class 'checked' is used in CSS but not declared in the component"
          loc: 'current_file:3:6'
      "
    `);
  });

  test('should not warn when class is declared as boolean style flag', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const CheckboxContainer = styled.button<{ checked: boolean }>\`
          opacity: 0.8;
          &.checked {
            background: lime;
            border-color: lime;
            opacity: 1;
          }
        \`
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      []
      "
    `);
  });

  test('should not warn when class is declared as string union style flag', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Button = styled.button<{ size: 'small' | 'large' }>\`
          padding: 8px;
          &.size-small {
            padding: 4px;
          }
          &.size-large {
            padding: 16px;
          }
        \`
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      []
      "
    `);
  });

  test('should warn about multiple undeclared classes', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Card = styled.div\`
          background: white;
          &.active {
            background: blue;
          }
          &.disabled {
            opacity: 0.5;
          }
          &.loading {
            cursor: wait;
          }
        \`
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      - TransformWarning#:
          message: "The class 'active' is used in CSS but not declared in the component"
          loc: 'current_file:3:6'
      - TransformWarning#:
          message: "The class 'disabled' is used in CSS but not declared in the component"
          loc: 'current_file:3:6'
      - TransformWarning#:
          message: "The class 'loading' is used in CSS but not declared in the component"
          loc: 'current_file:3:6'
      "
    `);
  });

  test('should warn about common global classes', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Container = styled.div\`
          padding: 16px;
          &.first {
            margin-top: 0;
          }
          &.last {
            margin-bottom: 0;
          }
          &.visible {
            display: block;
          }
        \`
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    // These classes are no longer filtered out
    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      - TransformWarning#:
          message: "The class 'first' is used in CSS but not declared in the component"
          loc: 'current_file:3:6'
      - TransformWarning#:
          message: "The class 'last' is used in CSS but not declared in the component"
          loc: 'current_file:3:6'
      - TransformWarning#:
          message: "The class 'visible' is used in CSS but not declared in the component"
          loc: 'current_file:3:6'
      "
    `);
  });

  test('should handle complex selectors correctly', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Button = styled.button\`
          background: white;
          &.primary:hover {
            background: blue;
          }
          &.secondary.large {
            padding: 20px;
          }
        \`
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      - TransformWarning#:
          message: "The class 'primary' is used in CSS but not declared in the component"
          loc: 'current_file:3:6'
      - TransformWarning#:
          message: "The class 'secondary' is used in CSS but not declared in the component"
          loc: 'current_file:3:6'
      - TransformWarning#:
          message: "The class 'large' is used in CSS but not declared in the component"
          loc: 'current_file:3:6'
      "
    `);
  });

  test('should not warn for extended styled components', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const BaseButton = styled.button\`
          padding: 8px;
        \`

        const PrimaryButton = styled(BaseButton)\`
          &.highlighted {
            box-shadow: 0 0 10px blue;
          }
        \`
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      []
      "
    `);
  });

  test('should not warn when component uses className with string interpolation', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
  
        const Component = styled.div\`
          background: white;
  
          &.active {
            background: blue;
          }
        \`

        // className could contain the unused class, so its not possible to warn about it
        const App: FC<{ className: string }> = ({ className }) => <Component className={\`test-\${className}\`} />
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(warnings.length).toBe(0);
  });
});

describe('CSS tagged templates', () => {
  test('classes in css tagged template are just ignored', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const cardStyles = css\`
          background: white;
          padding: 16px;
          &.featured {
            border: 2px solid gold;
          }
          &.compact {
            padding: 8px;
          }
        \`
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(warnings.length).toBe(0);
  });
});

describe('Mixed scenarios', () => {
  test('should work with both styled components and css templates', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled, css } from 'vindur'

        const Button = styled.button<{ active: boolean }>\`
          background: white;
          &.active {
            background: blue;
          }
          &.disabled {
            opacity: 0.5;
          }
        \`

        const cardStyles = css\`
          padding: 16px;
          &.highlighted {
            background: yellow;
          }
        \`
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      - TransformWarning#:
          message: "The class 'disabled' is used in CSS but not declared in the component"
          loc: 'current_file:3:6'
      "
    `);
  });
});

describe('cx prop', () => {
  test('should not warn about undeclared classes when they are used in cx prop', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Button = styled.button\`
          background: white;
  
          &.active {
            background: blue;
          }
        \`

        const App = () => (
          <Button cx={{ active: true, disabled: false }} />
        )
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      - TransformWarning#:
          message: 'Warning: Missing CSS classes for cx modifiers in Button: disabled'
          loc: 'current_file:12:2'
      "
    `);
  });
});

describe('Edge cases', () => {
  test('should handle CSS comments correctly', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Component = styled.div\`
          background: white;
          /* &.commented-out {
            display: none;
          } */
          &.active {
            background: blue;
          }
        \`
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      - TransformWarning#:
          message: "The class 'active' is used in CSS but not declared in the component"
          loc: 'current_file:3:6'
      "
    `);
  });

  test('should not warn in production mode', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Button = styled.button\`
          background: white;
          &.active {
            background: blue;
          }
        \`
      `,
      production: true,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      []
      "
    `);
  });

  test('should handle empty CSS gracefully', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Empty = styled.div\`\`
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      []
      "
    `);
  });

  test('should handle malformed selectors gracefully', async () => {
    const warnings: TransformWarning[] = [];

    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Component = styled.div\`
          background: white;
          &. {
            /* malformed selector */
          }
          &.123invalid {
            /* invalid class name */
          }
          &.valid-class {
            background: blue;
          }
        \`
      `,
      onWarning: (warning) => warnings.push(warning),
    });

    expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
      "
      - TransformWarning#:
          message: "The class 'valid-class' is used in CSS but not declared in the component"
          loc: 'current_file:3:6'
      "
    `);
  });
});
