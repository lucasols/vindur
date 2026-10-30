import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

test('should throw error for non-boolean and non-string-union types in style flags', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const StyledWithModifier = styled.div<{
          count: number; // Not boolean or string union
        }>\`
          &.active { ... }
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
    [TransformError: /test.tsx: Style flags only support boolean properties and string literal unions. Property "count" has type "number".
    loc: 4:2]
  `,
  );
});

test('should throw error for non-existent type reference in style flags', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const StyledButton = styled.div<NonExistentType>\`
          padding: 16px;
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
    [TransformError: /test.tsx: Type "NonExistentType" not found. Only locally defined types are supported for style flags
    loc: 3:32
    ignoreInLint: true]
  `,
  );
});

test('should throw error for complex type alias in style flags', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        type ComplexType = string | number | { nested: boolean };

        const StyledButton = styled.div<ComplexType>\`
          padding: 16px;
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
    [TransformError: /test.tsx: Type "ComplexType" must be a simple object type for style flags. Complex types like unions, intersections, or imported types are not supported
    loc: 5:32]
  `,
  );
});

test('should throw error for inline union types in style flags', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const StyledButton = styled.div<string | number>\`
          padding: 16px;
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
    [TransformError: /test.tsx: Style flags only support simple object types like "{ prop: boolean }" or type references. Complex inline types like "string | number" are not supported
    loc: 3:32]
  `,
  );
});

test('should throw error for inline intersection types in style flags', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const StyledButton = styled.div<{ a: boolean } & { b: string }>\`
          padding: 16px;
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
    [TransformError: /test.tsx: Style flags only support simple object types like "{ prop: boolean }" or type references. Complex inline types like "{ ... } & { ... }" are not supported
    loc: 3:32]
  `,
  );
});

test('should throw error for inline union of object types in style flags', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const StyledButton = styled.div<{ active: boolean } | { disabled: boolean }>\`
          padding: 16px;
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
    [TransformError: /test.tsx: Style flags only support simple object types like "{ prop: boolean }" or type references. Complex inline types like "{ ... } | { ... }" are not supported
    loc: 3:32]
  `,
  );
});

test('should throw error for non-existent nested type reference in style flags', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        type Flags = {
          level: NonExistentLevels;
        };

        const StyledButton = styled.div<Flags>\`
          padding: 16px;
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
    [TransformError: /test.tsx: Type "NonExistentLevels" not found. Only locally defined types are supported for style flags
    loc: 4:2]
  `,
  );
});

test('should throw error for complex nested type in style flags', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        type ComplexLevels = string | { nested: boolean };

        type Flags = {
          level: ComplexLevels;
        };

        const StyledButton = styled.div<Flags>\`
          padding: 16px;
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
    [TransformError: /test.tsx: Referenced type must be a string literal union. Property "level" references type "string | { ... }" which is not supported
    loc: 6:2]
  `,
  );
});

test('should throw error for non-string union nested type in style flags', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        type NumberLevels = 1 | 2 | 3;

        type Flags = {
          level: NumberLevels;
        };

        const StyledButton = styled.div<Flags>\`
          padding: 16px;
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(
    `
    [TransformError: /test.tsx: Referenced type must be a string literal union. Property "level" references type "1 | 2 | 3" which is not supported
    loc: 6:2]
  `,
  );
});

test('should warn about missing modifier styles', async () => {
  const warnings: TransformWarning[] = [];

  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const StyledWithModifier = styled.div<{
        active: boolean;
      }>\`
        padding: 16px;
      \`;

      function Component() {
        return (
          <StyledWithModifier active={true}>
            Content
          </StyledWithModifier>
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
        message: 'Warning: Missing modifier styles for "&.active" in StyledWithModifier'
        loc: 'current_file:3:6'
    "
  `);

  expect(result.code).toMatchInlineSnapshot(`
    "function Component() {
      return (
        <div className={"v1560qbr-1-StyledWithModifier voctcyj-active"}>
          Content
        </div>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-StyledWithModifier {
      padding: 16px;
    }
    "
  `);
});

test('should throw for style flag values that are not valid class names', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Button = styled.div<{ size: 'extra large' | 'small' }>\`
          &.size-small { padding: 4px; }
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "size" value "extra large" must only contain letters, digits, - and _, as it becomes part of a class name
    loc: 3:34]
  `);
});

test('should throw for style flag names containing `$`', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Box = styled.div<{ is$on: boolean }>\`
          &.is$on { color: red; }
        \`;

        export const App = () => <Box is$on />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag \`is$on\` can't contain \`$\`, as it becomes part of a class name
    loc: 3:25]
  `);
});

test('should throw for style flags named like props React, vindur or the element handle', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Item = styled.div<{ key: boolean }>\`
          &.key { color: red; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag \`key\` is a prop React, vindur or the element handles, style flags are turned into classes and never passed to the element, so use another name
    loc: 3:26]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Button = styled.button<{ disabled: boolean }>\`
          &.disabled { opacity: 0.5; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag \`disabled\` is a prop React, vindur or the element handles, style flags are turned into classes and never passed to the element, so use another name
    loc: 3:31]
  `);
});

test('should throw for string union style flag values with side effects', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Box = styled.div<{ size: 'small' | 'large' }>\`
          &.size-small { width: 1px; }
          &.size-large { width: 2px; }
        \`

        export const App = ({ getSize }) => <Box size={getSize()} />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag \`size\` value can't contain calls, \`new\`, assignments, \`++\`, \`--\`, \`delete\`, \`await\` or tagged templates, as it's read twice, assign it to a variable first
    loc: 8:47]
  `);
});

test('should throw for style flag classes in rules matching other elements too', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Box = styled.div<{ active: boolean }>\`
          &:hover, & .child {
            &.active { color: red; }
          }
        \`

        export const App = () => <Box active />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag "active" can't be used in a rule that matches both the element and other elements, like "&.active" nested in "&:hover, & .child" or ":where(&, .x)". Split the selectors into separate rules.
    loc: 5:6]
  `);
});

test('should throw for style flags on a default exported styled component', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        export default styled.button<{ active: boolean }>\`
          &.active { color: red; }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flags are not supported on a default exported styled component, assign it to a \`const\` and export that
    loc: 2:28]
  `);
});

test('should throw for delete in string union style flag values', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        const Box = styled.div<{ size: 'small' | 'large' }>\`
          &.size-small { width: 1px; }
          &.size-large { width: 2px; }
        \`
        export const App = ({ obj }) => <Box size={'pending' in obj ? (delete obj.pending, 'small') : 'large'} />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag \`size\` value can't contain calls, \`new\`, assignments, \`++\`, \`--\`, \`delete\`, \`await\` or tagged templates, as it's read twice, assign it to a variable first
    loc: 6:63]
  `);
});

test('should not warn about classes of descendants in :has()', async () => {
  const warnings: TransformWarning[] = [];
  await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      const Box = styled.div<{ active: boolean }>\`
        &.active { color: red; }
        &:has(.icon) { color: blue; }
      \`
      export const App = () => <Box active />
    `,
    onWarning: (warning) => warnings.push(warning),
  });

  expect(warnings).toHaveLength(0);
});
