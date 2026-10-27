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
          "v1560qbr-1-Button v1560qbr-1-Button-size-small" +
          (active ? " v1560qbr-1-Button-active" : "")
        }
      />
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      &.v1560qbr-1-Button-active.v1560qbr-1-Button-size-small {
        color: red;
      }
      .parent &.v1560qbr-1-Button-active,
      &:focus-visible.v1560qbr-1-Button-size-large {
        color: blue;
      }
      &:not(.v1560qbr-1-Button-active) {
        opacity: 0.5;
      }
      :is(&.v1560qbr-1-Button-active, &.v1560qbr-1-Button-size-large) {
        outline: none;
      }
      &:nth-child(1 of .v1560qbr-1-Button-size-small) {
        color: green;
      }
      &:hover {
        &.v1560qbr-1-Button-active {
          color: orange;
        }
      }
      @media (min-width: 600px) {
        &.v1560qbr-1-Button-size-small {
          color: purple;
        }
      }
      @scope (&.v1560qbr-1-Button-active) {
        :scope.v1560qbr-1-Button-size-large {
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
      &.v1560qbr-1-Button-active,
      &.v1560qbr-1-Button-size-small,
      &.v1560qbr-1-Button-size-large {
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
    loc: 4:24]
  `);

  await expect(
    transformWithFormat({ source: styled(':where(&, .x)', '$active') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "$active" can't be used in a rule that matches both the element and other elements, like "&.$active" nested in "&:hover, & .child" or ":where(&, .x)". Split the selectors into separate rules.
    loc: 4:20]
  `);
});

test('should throw for $ prefixed style flags used inside selectors of other elements', async () => {
  const styled = (flag: string, selector: string) => dedent`
    import { styled } from 'vindur';

    const Button = styled.button<{ ${flag}: boolean }>\`
      &.${flag} { color: red; }
      ${selector} { color: blue; }
    \`;

    export const App = () => <Button ${flag} />;
  `;

  await expect(
    transformWithFormat({ source: styled('$active', '&:has(.$active)') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "$active" can only be used in selectors of the element itself, e.g. "&.$active"
    loc: 5:9]
  `);

  await expect(transformWithFormat({ source: styled('is$on', '& .is$on') }))
    .rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "is$on" can only be used in selectors of the element itself, e.g. "&.is$on"
    loc: 5:5]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Button = styled.button<{ $active: boolean }>\`
          div {
            & .$active {
              color: blue;
            }
          }
        \`;

        export const App = () => <Button $active />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "$active" can only be used in selectors of the element itself, e.g. "&.$active"
    loc: 5:7]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { styled, layer } from 'vindur';

        const Button = styled.button<{ $active: boolean }>\`
          \${layer('base')} {
            & .$active {
              color: blue;
            }
          }
        \`;

        export const App = () => <Button $active />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "$active" can only be used in selectors of the element itself, e.g. "&.$active"
    loc: 5:7]
  `);
});

test('should throw for escaped style flag selectors', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Button = styled.button<{ $active: boolean }>\`
          &.\\\\$active {
            color: red;
          }
        \`;

        export const App = () => <Button $active />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "$active" can't be escaped, write it as "&.$active"
    loc: 4:6]
  `);
});

test('should throw for style flag selectors escaped with a code point', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Button = styled.button<{ $active: boolean }>\`
          &.\\24 active {
            color: red;
          }
        \`;

        export const App = () => <Button $active />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "$active" can't be escaped, write it as "&.$active"
    loc: 4:5]
  `);
});

test('should not confuse $ prefixed style flags with _ prefixed classes', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Button = styled.button<{ $active: boolean; é$on: boolean }>\`
        &.$active {
          color: red;
        }
        &._active {
          color: blue;
        }
        &.é$on {
          color: green;
        }
      \`;

      const Link = styled.a<{ $active: boolean }>\`
        &.$active {
          color: red;
        }
        &._active {
          color: blue;
        }
      \`;

      export const App = () => (
        <>
          <Button $active className="_active" é$on />
          <Link $active className="_active" />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = () => (
      <>
        <button
          className={
            "v1560qbr-1-Button _active v1560qbr-1-Button-_active v1560qbr-1-Button-é_on"
          }
        />
        <a className={"v1560qbr-2-Link _active v1560qbr-2-Link-_active"} />
      </>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      &.v1560qbr-1-Button-_active {
        color: red;
      }
      &._active {
        color: blue;
      }
      &.v1560qbr-1-Button-é_on {
        color: green;
      }
    }

    .v1560qbr-2-Link {
      &.v1560qbr-2-Link-_active {
        color: red;
      }
      &._active {
        color: blue;
      }
    }
    "
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
        message: "The style flag class \\"active\\" is used in a selector of another element in Card, where it is kept as written and doesn't match the flag. Flag classes only apply to the element itself, e.g. \\"&.active\\""
        loc: 'current_file:3:6'
    - TransformWarning#:
        message: "The style flag class \\"size-small\\" is used in a selector of another element in Card, where it is kept as written and doesn't match the flag. Flag classes only apply to the element itself, e.g. \\"&.size-small\\""
        loc: 'current_file:3:6'
    - TransformWarning#:
        message: "The style flag class \\"size-large\\" is used in a selector of another element in Card, where it is kept as written and doesn't match the flag. Flag classes only apply to the element itself, e.g. \\"&.size-large\\""
        loc: 'current_file:3:6'
    "
  `);
});

test('should warn about style flags also used by other elements', async () => {
  const warnings: TransformWarning[] = [];

  await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Item = styled.div<{ active: boolean }>\`
        &.active {
          color: red;
        }
        .active > & {
          color: blue;
        }
      \`;
    `,
    onWarning: (warning) => warnings.push(warning),
  });

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: "The style flag class \\"active\\" is used in a selector of another element in Item, where it is kept as written and doesn't match the flag. Flag classes only apply to the element itself, e.g. \\"&.active\\""
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
