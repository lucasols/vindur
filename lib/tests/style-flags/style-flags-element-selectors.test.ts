import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

test('should hash style flags in every selector of the element', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Button = styled.button<{
        active: boolean;
        size: 'small' | 'large';
      }>\`
        &.active.size-small {
          color: red;
        }
        .parent &.active, &:focus-visible.size-large {
          color: blue;
        }
        &:not(.active) {
          opacity: 0.5;
        }
        :is(&.active, &.size-large) {
          outline: none;
        }
        &:nth-child(1 of .size-small) {
          color: green;
        }
        &:hover {
          &.active {
            color: orange;
          }
        }
        @media (min-width: 600px) {
          &.size-small {
            color: purple;
          }
        }
        @scope (&.active) {
          :scope.size-large {
            color: pink;
          }
        }
      \`;

      export const App = ({ active }: { active: boolean }) => (
        <Button active={active} size="small" />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = ({ active }: { active: boolean }) => (
      <button
        className={
          "v1560qbr-1-Button vr4ikfs-size-small" + (active ? " voctcyj-active" : "")
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      &.voctcyj-active.vr4ikfs-size-small {
        color: red;
      }
      .parent &.voctcyj-active,
      &:focus-visible.vr4ikfs-size-large {
        color: blue;
      }
      &:not(.voctcyj-active) {
        opacity: 0.5;
      }
      :is(&.voctcyj-active, &.vr4ikfs-size-large) {
        outline: none;
      }
      &:nth-child(1 of .vr4ikfs-size-small) {
        color: green;
      }
      &:hover {
        &.voctcyj-active {
          color: orange;
        }
      }
      @media (min-width: 600px) {
        &.vr4ikfs-size-small {
          color: purple;
        }
      }
      @scope (&.voctcyj-active) {
        :scope.vr4ikfs-size-large {
          color: pink;
        }
      }
    }
    "
  `);
});

test('should keep style flag names used by other elements', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Button = styled.button<{
        active: boolean;
        size: 'small' | 'large';
      }>\`
        --label: &.active;
        content: ".size-small";
        /* &.active */
        &.active, &.size-small, &.size-large {
          color: red;
        }
        & .active, & + .size-small {
          color: blue;
        }
        .active & {
          color: green;
        }
        &:has(.size-large) {
          color: orange;
        }
        & .child {
          &.active {
            color: purple;
          }
        }
        &.active-icon {
          color: pink;
        }
      \`;

      export const App = () => <Button active size="small" />;
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      --label: &.active;
      content: ".size-small";
      /* &.active */
      &.voctcyj-active,
      &.vr4ikfs-size-small,
      &.vr4ikfs-size-large {
        color: red;
      }
      & .active,
      & + .size-small {
        color: blue;
      }
      .active & {
        color: green;
      }
      &:has(.size-large) {
        color: orange;
      }
      & .child {
        &.active {
          color: purple;
        }
      }
      &.active-icon {
        color: pink;
      }
    }
    "
  `);
});

test('should throw for $ prefixed style flags used by other elements', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Button = styled.button<{ $active: boolean }>\`
          &.$active {
            color: red;
          }
          & .$active {
            color: blue;
          }
        \`;

        export const App = () => <Button $active />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "$active" can only be used in selectors of the element itself, e.g. "&.$active"
    loc: 7:5]
  `);
});

test('should reject style flags in rules that match both the element and other elements', async () => {
  const styled = (selector: string, flag: string) => dedent`
    import { styled } from 'vindur';

    const Button = styled.button<{ ${flag}: boolean }>\`
      ${selector} { &.${flag} { color: red; } }
    \`;

    export const App = () => <Button ${flag} />;
  `;

  await expect(
    transformWithFormat({ source: styled('&:hover, & .child', 'active') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "active" can't be used in a rule that matches both the element and other elements, like "&.active" nested in "&:hover, & .child" or ":where(&, .x)". Split the selectors into separate rules.
    loc: 3:15]
  `);

  await expect(
    transformWithFormat({ source: styled(':where(&, .x)', '$active') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "$active" can't be used in a rule that matches both the element and other elements, like "&.$active" nested in "&:hover, & .child" or ":where(&, .x)". Split the selectors into separate rules.
    loc: 3:15]
  `);
});

test('should warn about style flags only used by other elements', async () => {
  const warnings: TransformWarning[] = [];

  await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Card = styled.div<{
        active: boolean;
        size: 'small' | 'large';
        selected: boolean;
      }>\`
        & .active {
          color: red;
        }
        .size-small & {
          color: blue;
        }
        /* &.size-large */
        &:has(.size-large) {
          color: green;
        }
        :is(&.selected) {
          color: orange;
        }
      \`;
    `,
    onWarning: (warning) => warnings.push(warning),
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: 'Warning: Missing modifier styles for "&.active" in Card'
        loc: 'current_file:3:6'
    - TransformWarning#:
        message: 'Warning: Missing modifier styles for "&.size-small" in Card'
        loc: 'current_file:3:6'
    - TransformWarning#:
        message: 'Warning: Missing modifier styles for "&.size-large" in Card'
        loc: 'current_file:3:6'
    "
  `);
});

test('should find style flags in nested selectors of the element', async () => {
  const warnings: TransformWarning[] = [];

  await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Card = styled.div<{
        active: boolean;
        size: 'small' | 'large';
      }>\`
        :where(&.active) {
          color: red;
        }
        &:not(.size-small) {
          color: blue;
        }
        @scope (&) {
          :scope.size-large {
            color: green;
          }
        }
      \`;
    `,
    onWarning: (warning) => warnings.push(warning),
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});
