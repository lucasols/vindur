import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should work with nested type references', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      type Levels = 'a' | 'b' | 'c';
      type IsActive = boolean;

      type NestedFlags = {
        levels: Levels;
        active: IsActive;
      };

      const Btn = styled(ButtonElement)<NestedFlags>\`
        border: 0;
        background: transparent;
        color: white;

        &:hover,
        &.active {
          opacity: 1;
        }

        &.levels-a {
          color: red;
        }
        &.levels-b {
          color: yellow;
        }
        &.levels-c {
          color: cyan;
        }
      \`;

      function Component({ levels, active }) {
        return <Btn levels={levels} active={active}>Content</Btn>;
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "type Levels = "a" | "b" | "c";
    type IsActive = boolean;
    type NestedFlags = {
      levels: Levels;
      active: IsActive;
    };
    function Component({ levels, active }) {
      return (
        <ButtonElement
          className={
            "v1560qbr-1-Btn" +
            (levels ? " v1dm245a-levels-" + levels : "") +
            (active ? " voctcyj-active" : "")
          }
        >
          Content
        </ButtonElement>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Btn {
      border: 0;
      background: transparent;
      color: white;

      &:hover,
      &.voctcyj-active {
        opacity: 1;
      }

      &.v1dm245a-levels-a {
        color: red;
      }
      &.v1dm245a-levels-b {
        color: yellow;
      }
      &.v1dm245a-levels-c {
        color: cyan;
      }
    }
    "
  `);
});