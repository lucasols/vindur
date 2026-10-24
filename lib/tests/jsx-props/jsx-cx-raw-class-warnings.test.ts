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

      \${Menu}.isActive & {
        font-weight: bold;
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
        message: 'cx key "isOpen" is hashed, but the class ".isOpen" is used in other selectors of this file, which will never match it. Use "$isOpen" to keep the class name, or rename one of the classes'
        loc: '/test.tsx:31:16'
    - TransformWarning#:
        message: 'cx key "isActive" is hashed, but the class ".isActive" is used in other selectors of this file, which will never match it. Use "$isActive" to keep the class name, or rename one of the classes'
        loc: '/test.tsx:31:30'
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
    \`;

    const Panel = styled.div\`
      &.isActive {
        color: red;
      }
    \`;

    const Item = styled.span\`
      .isActive & {
        color: black;
      }
    \`;

    export const A = ({ open }: { open: boolean }) => (
      <>
        <Menu cx={{ isOpen: open, isOpenLater: !open }} />
        <Panel cx={{ $isActive: open }}>
          <Item />
        </Panel>
        <Panel cx={{ isActive: open }} />
      </>
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
