import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

test('should resolve flags after attribute selectors, comments and uppercase pseudo-classes', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Menu = styled.div<{ active: boolean }>\`
        &.active {
          color: red;
        }
      \`;

      const Item = styled.span<{ active: boolean }>\`
        &.active {
          color: blue;
        }

        \${Menu}[data-tags~="primary"].active & {
          color: green;
        }

        \${Menu}[data-kind = "list"]:hover.active & {
          color: teal;
        }

        \${Menu}:not(.active /* only the closed menu */) & {
          color: gray;
        }

        \${Menu}:NOT(.active) & {
          opacity: 0.5;
        }
      \`;

      function Component({ active }: { active: boolean }) {
        return (
          <Menu active={active}>
            <Item active={active} />
          </Menu>
        );
      }
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Menu {
      &.v1560qbr-1-Menu-active {
        color: red;
      }
    }

    .v1560qbr-2-Item {
      &.v1560qbr-2-Item-active {
        color: blue;
      }

      .v1560qbr-1-Menu[data-tags~="primary"].v1560qbr-1-Menu-active & {
        color: green;
      }

      .v1560qbr-1-Menu[data-kind="list"]:hover.v1560qbr-1-Menu-active & {
        color: teal;
      }

      .v1560qbr-1-Menu:not(.v1560qbr-1-Menu-active /* only the closed menu */) & {
        color: gray;
      }

      .v1560qbr-1-Menu:not(.v1560qbr-1-Menu-active) & {
        opacity: 0.5;
      }
    }
    "
  `);
});

test('should reject classes before a component reference in the same compound', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Menu = styled.div<{ open: boolean }>\`
          &.open {
            color: red;
          }
        \`;

        const Item = styled.span<{ open: boolean }>\`
          &.open {
            color: blue;
          }

          .open\${Menu} & {
            display: block;
          }
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: A component reference must start its compound selector, like \`\${Menu}.active\`, not \`.active\${Menu}\`
    loc: 14:9]
  `);
});

test('should reject classes inside functions other than :not(), :is(), :where() and :has() after a component reference', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Menu = styled.div<{ active: boolean }>\`
          &.active {
            color: red;
          }
        \`;

        const Item = styled.span<{ active: boolean }>\`
          &.active {
            color: blue;
          }

          \${Menu}:nth-child(1 of .active) & {
            display: block;
          }
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: After a component reference, only \`:not()\`, \`:is()\`, \`:where()\` and \`:has()\` can contain classes, like \`\${Menu}:not(.active)\`
    loc: 14:25]
  `);
});

test('should reject classes of & nested in a component reference rule', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Menu = styled.div<{ open: boolean }>\`
          &.open {
            color: red;
          }
        \`;

        const Item = styled.span<{ open: boolean }>\`
          &.open {
            color: blue;
          }

          \${Menu} {
            @media (min-width: 600px) {
              &:not(.open) {
                display: none;
              }
            }
          }
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`&\` nested in a component reference's rule, like \`\${Menu} { &.active {} }\`, can't select classes, write \`\${Menu}.active\` instead
    loc: 16:12]
  `);
});

test('should reject classes of & nested in a component reference rule in global styles', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle, styled } from 'vindur';

        const Menu = styled.div<{ open: boolean }>\`
          &.open {
            color: red;
          }
        \`;

        createGlobalStyle\`
          \${Menu} {
            &.open {
              color: green;
            }
          }
        \`;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: \`&\` nested in a component reference's rule, like \`\${Menu} { &.active {} }\`, can't select classes, write \`\${Menu}.active\` instead
    loc: 11:5]
  `);
});

test('should resolve flags chained to a withComponent of an extended component', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Base = styled.div\`
        color: red;
      \`;

      const Menu = styled(Base)<{ active: boolean }>\`
        &.active {
          color: blue;
        }
      \`;

      const MenuLink = Menu.withComponent('a');

      const Item = styled.span\`
        \${MenuLink}.active & {
          color: green;
        }
      \`;

      function Component({ active }: { active: boolean }) {
        return (
          <MenuLink active={active}>
            <Item />
          </MenuLink>
        );
      }
    `,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Base {
      color: red;
    }

    .v1560qbr-2-Menu {
      &.v1560qbr-2-Menu-active {
        color: blue;
      }
    }

    .v1560qbr-3-Item {
      .v1560qbr-2-Menu.v1560qbr-2-Menu-active & {
        color: green;
      }
    }
    "
  `);
});

test('should not warn about component references and their flags inside :has()', async () => {
  const warnings: TransformWarning[] = [];

  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Menu = styled.div<{ open: boolean }>\`
        &.open {
          color: red;
        }
      \`;

      const Item = styled.span\`
        &:has(\${Menu}.open) {
          color: green;
        }
      \`;

      function Component({ open }: { open: boolean }) {
        return (
          <Item>
            <Menu open={open} />
          </Item>
        );
      }
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Menu {
      &.v1560qbr-1-Menu-open {
        color: red;
      }
    }

    .v1560qbr-2-Item {
      &:has(.v1560qbr-1-Menu.v1560qbr-1-Menu-open) {
        color: green;
      }
    }
    "
  `);

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});
