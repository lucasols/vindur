import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../../src/custom-errors';
import { transformWithFormat } from '../testUtils';

async function getWarnings(source: string, production = false) {
  const warnings: TransformWarning[] = [];
  await transformWithFormat({
    source,
    production,
    onWarning: (warning) => warnings.push(warning),
  });
  return warnings;
}

test('should warn when a hashed cx key is used as a raw class in other selectors', async () => {
  const warnings = await getWarnings(dedent`
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

      &.isActive {
        color: red;
      }
    \`;

    const Item = styled.span\`
      .isActive & {
        color: black;
      }
    \`;

    export const A = ({ open, active }: { open: boolean; active: boolean }) => (
      <>
        <Menu cx={{ isOpen: open, isActive: active }}>
          <Item />
        </Menu>
        <Menu cx={{ isActive: active }} />
      </>
    );
  `);

  expect(compactSnapshot(warnings)).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: 'cx key "isOpen" is hashed, but the selector ".isOpen .icon" uses the class ".isOpen", which will never match it. Use "$isOpen" to keep the class name, or rename one of the classes'
        loc: '/test.tsx:27:16'
    - TransformWarning#:
        message: 'cx key "isActive" is hashed, but the selector ".isActive &" uses the class ".isActive", which will never match it. Use "$isActive" to keep the class name, or rename one of the classes'
        loc: '/test.tsx:27:30'
    "
  `);
});

test('should not warn when the raw class is only used by the component itself or by $ keys', async () => {
  const warnings = await getWarnings(dedent`
    import { styled } from 'vindur';

    const Menu = styled.div\`
      &.isOpen {
        display: block;
      }

      &.isOpenLater {
        display: none;
      }

      .isOpenLater-wrapper & {
        display: flex;
      }
    \`;

    const Panel = styled.div\`
      &.isActive {
        color: red;
      }
    \`;

    const Badge = styled.div\`
      color: blue;
    \`;

    const Item = styled.span\`
      .isActive & {
        color: black;
      }
    \`;

    export const A = ({ open }: { open: boolean }) => (
      <>
        <Menu cx={{ isOpen: open, isOpenLater: !open }} />
        <Badge cx={{ $isActive: open }}>
          <Item />
        </Badge>
        <Panel cx={{ isActive: open }} />
      </>
    );
  `);

  expect(warnings).toEqual([]);
});

test('should not warn about raw classes of the selected elements, comments or values', async () => {
  const warnings = await getWarnings(dedent`
    import { styled } from 'vindur';

    const List = styled.ul\`
      /* toggled with .active */
      background: url(/icons/active.svg);

      &.active {
        color: red;
      }

      & .active {
        color: blue;
      }

      &:has(.active) {
        color: green;
      }
    \`;

    const Tab = styled.li\`
      &.active {
        font-weight: bold;
      }
    \`;

    export const A = ({ on }: { on: boolean }) => (
      <List cx={{ active: on }}>
        <Tab className="active" />
      </List>
    );
  `);

  expect(warnings).toEqual([]);
});

test('should not warn about raw cx key classes in production', async () => {
  const warnings = await getWarnings(
    dedent`
      import { styled } from 'vindur';

      const Menu = styled.div\`
        &.isOpen {
          display: block;
        }
      \`;

      const Item = styled.span\`
        .isOpen & {
          color: black;
        }
      \`;

      export const A = ({ open }: { open: boolean }) => (
        <Menu cx={{ isOpen: open }}>
          <Item />
        </Menu>
      );
    `,
    true,
  );

  expect(warnings).toEqual([]);
});
