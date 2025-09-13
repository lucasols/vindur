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
