import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

test('should reject a hashed cx key used as a raw class in :has() of the element', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Box = styled.div\`
          &.hasHiddenItems {
            &.isShown {
              display: block;
            }

            &:has(.isShown) {
              display: flex;
            }
          }
        \`;

        export const A = ({ isShown }: { isShown: boolean }) => (
          <Box cx={{ isShown }} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "isShown" is hashed, so the class ".isShown" in the selector "&.hasHiddenItems { &:has(.isShown) }" never matches elements that get it through cx. Use "$isShown" in the cx prop to keep the class name, or rename one of the classes
    loc: 16:13]
  `);
});

test('should reject a hashed cx key used as a raw class of descendants', async () => {
  const source = (selector: string) => dedent`
    import { styled } from 'vindur';

    const Box = styled.div\`
      &.active {
        color: red;
      }

      ${selector}
    \`;

    export const A = ({ active }: { active: boolean }) => (
      <Box cx={{ active }} />
    );
  `;

  await expect(
    transformWithFormat({ source: source('& .active { color: blue; }') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "active" is hashed, so the class ".active" in the selector "& .active" never matches elements that get it through cx. Use "$active" in the cx prop to keep the class name, or rename one of the classes
    loc: 12:13]
  `);
  await expect(
    transformWithFormat({ source: source('> .active { color: blue; }') }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "active" is hashed, so the class ".active" in the selector "> .active" never matches elements that get it through cx. Use "$active" in the cx prop to keep the class name, or rename one of the classes
    loc: 12:13]
  `);
  await expect(
    transformWithFormat({
      source: source('> .child { &.active { color: blue; } }'),
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "active" is hashed, so the class ".active" in the selector "> .child { &.active }" never matches elements that get it through cx. Use "$active" in the cx prop to keep the class name, or rename one of the classes
    loc: 12:13]
  `);
});

test('should reject a hashed cx key used as a raw class of ancestors in other components and global styles', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';

        const Menu = styled.div\`
          &.isActive {
            color: red;
          }
        \`;

        const Item = styled.span\`
          .isActive & {
            color: black;
          }
        \`;

        export const A = ({ active }: { active: boolean }) => (
          <Menu cx={{ isActive: active }}>
            <Item />
          </Menu>
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "isActive" is hashed, so the class ".isActive" in the selector ".isActive &" never matches elements that get it through cx. Use "$isActive" in the cx prop to keep the class name, or rename one of the classes
    loc: 16:14]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { styled, createGlobalStyle } from 'vindur';

        createGlobalStyle\`
          .isOpen .icon {
            rotate: 180deg;
          }
        \`;

        const Menu = styled.div\`
          &.isOpen {
            display: block;
          }
        \`;

        export const A = ({ open }: { open: boolean }) => (
          <Menu cx={{ isOpen: open }} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "isOpen" is hashed, so the class ".isOpen" in the selector ".isOpen .icon" never matches elements that get it through cx. Use "$isOpen" in the cx prop to keep the class name, or rename one of the classes
    loc: 16:14]
  `);
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled, createGlobalStyle } from 'vindur';

        createGlobalStyle\`
          html {
            &.isOpen {
              overflow: hidden;
            }
          }
        \`;

        const Menu = styled.div\`
          &.isOpen {
            display: block;
          }
        \`;

        export const A = ({ open }: { open: boolean }) => (
          <Menu cx={{ isOpen: open }} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "isOpen" is hashed, so the class ".isOpen" in the selector "html { &.isOpen }" never matches elements that get it through cx. Use "$isOpen" in the cx prop to keep the class name, or rename one of the classes
    loc: 18:14]
  `);
});

test('should reject a hashed cx key selected through its css reference in global styles', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, createGlobalStyle } from 'vindur';

        const styles = css\`
          &.active {
            color: blue;
          }
        \`;

        createGlobalStyle\`
          @layer theme {
            \${styles} {
              &.active {
                opacity: 0.5;
              }
            }
          }
        \`;

        export const A = ({ active }: { active: boolean }) => (
          <div className={styles} cx={{ active }} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "active" is hashed, so the class ".active" in the selector ".v1560qbr-1-styles { &.active }" never matches elements that get it through cx. Use "$active" in the cx prop to keep the class name, or rename one of the classes
    loc: 20:32]
  `);
});

test('should reject a hashed cx key used as a raw class in the template of a parent component, also in production', async () => {
  const source = dedent`
    import { styled } from 'vindur';

    const Box = styled.div\`
      &.active {
        color: blue;
      }
    \`;

    const Panel = styled.div\`
      .active {
        color: red;
      }
    \`;

    export const A = ({ active }: { active: boolean }) => (
      <Panel>
        <Box cx={{ active }} />
      </Panel>
    );
  `;

  await expect(transformWithFormat({ source })).rejects
    .toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "active" is hashed, so the class ".active" in the selector ".active" never matches elements that get it through cx. Use "$active" in the cx prop to keep the class name, or rename one of the classes
    loc: 17:15]
  `);
  await expect(transformWithFormat({ source, production: true })).rejects
    .toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "active" is hashed, so the class ".active" in the selector ".active" never matches elements that get it through cx. Use "$active" in the cx prop to keep the class name, or rename one of the classes
    loc: 17:15]
  `);
});

test('should allow the modifiers of other components, comments and values with the name of a hashed cx key', async () => {
  const warnings: TransformWarning[] = [];

  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const List = styled.ul\`
        /* toggled with .active */
        background: url(/icons/active.svg);

        &.active {
          color: red;
        }
      \`;

      const Tab = styled.li\`
        &.active {
          font-weight: bold;
        }

        .list &.active {
          color: blue;
        }

        &:not(.active) {
          opacity: 0.5;
        }
      \`;

      export const A = ({ on }: { on: boolean }) => (
        <List cx={{ active: on }}>
          <Tab className="active" />
          <Tab cx={{ $active: on }} />
        </List>
      );
    `,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-List {
      /* toggled with .active */
      background: url(/icons/active.svg);

      &.v1560qbr-3-active {
        color: red;
      }
    }

    .v1560qbr-2-Tab {
      &.active {
        font-weight: bold;
      }

      .list &.active {
        color: blue;
      }

      &:not(.active) {
        opacity: 0.5;
      }
    }
    "
  `);

  expect(warnings).toEqual([]);
});

test('should reject raw modifiers in other styles of css references carried by elements that hash the key', async () => {
  const globalCard = dedent`
    createGlobalStyle\`
      \${card} {
        &.active {
          outline: 1px solid;
        }
      }
    \`;
  `;

  await expect(
    transformWithFormat({
      source: dedent`
        import { css, styled, createGlobalStyle } from 'vindur';

        const card = css\`
          color: red;
        \`;

        const Box = styled.div\`
          &.active {
            color: blue;
          }
        \`;

        ${globalCard}

        export const A = ({ active }: { active: boolean }) => (
          <Box className={card} cx={{ active }} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "active" is hashed, so the class ".active" in the selector ".v1560qbr-1-card { &.active }" never matches elements that get it through cx. Use "$active" in the cx prop to keep the class name, or rename one of the classes
    loc: 22:30]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css, styled, createGlobalStyle } from 'vindur';

        const card = css\`
          color: red;
        \`;

        const Box = styled.div.attrs({ className: card })\`
          &.active {
            color: blue;
          }
        \`;

        ${globalCard}

        export const A = ({ active }: { active: boolean }) => <Box cx={{ active }} />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "active" is hashed, so the class ".active" in the selector ".v1560qbr-1-card { &.active }" never matches elements that get it through cx. Use "$active" in the cx prop to keep the class name, or rename one of the classes
    loc: 21:65]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css, cx, createGlobalStyle } from 'vindur';

        const card = css\`
          color: red;
        \`;

        ${globalCard}

        export const A = ({ active, b }: { active: boolean; b: boolean }) => (
          <div
            css={\`
              &.active {
                color: blue;
              }
            \`}
            className={cx(card, b && 'x')}
            cx={{ active }}
          />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "active" is hashed, so the class ".active" in the selector ".v1560qbr-1-card { &.active }" never matches elements that get it through cx. Use "$active" in the cx prop to keep the class name, or rename one of the classes
    loc: 23:10]
  `);
});

test('should reject modifiers of other components in global styles', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle, styled } from 'vindur';

        const Item = styled.div\`
          &.selected {
            color: blue;
          }
        \`;

        const Box = styled.div\`
          color: red;
        \`;

        createGlobalStyle\`
          \${Box} {
            &.selected {
              color: green;
            }
          }
        \`;

        export const A = ({ selected }: { selected: boolean }) => (
          <>
            <Item cx={{ selected }} />
            <Box className="selected" />
          </>
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "selected" is hashed, so the class ".selected" in the selector ".v1560qbr-2-Box { &.selected }" never matches elements that get it through cx. Use "$selected" in the cx prop to keep the class name, or rename one of the classes
    loc: 23:16]
  `);
});

test('should reject modifiers in global styles that start with the hashing component', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle, styled } from 'vindur';

        const Box = styled.div\`
          &.active {
            color: red;
          }
        \`;

        createGlobalStyle\`
          \${Box} {
            color: blue;
          }

          .other {
            &.active {
              color: green;
            }
          }
        \`;

        export const A = ({ active }: { active: boolean }) => (
          <Box cx={{ active }} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx key "active" is hashed, so the class ".active" in the selector ".other { &.active }" never matches elements that get it through cx. Use "$active" in the cx prop to keep the class name, or rename one of the classes
    loc: 22:13]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle, styled } from 'vindur';

        const Box = styled.div\`
          &.active {
            color: red;
          }
        \`;

        createGlobalStyle\`
          \${Box} {
            &.active {
              color: blue;
            }
          }
        \`;

        export const A = ({ active }: { active: boolean }) => (
          <Box cx={{ active }} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop class "active" can't be hashed on styled component "Box", other styles select it through a component reference, like "\${Box}.active", which would stop matching. Use a $-prefixed class (e.g. $active) or a style flag.
    loc: 18:13]
  `);
});
