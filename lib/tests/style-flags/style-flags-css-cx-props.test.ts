import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should merge static style flags into the css prop className', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div<{ active: boolean; size: 'small' | 'large' }>\`
        padding: 8px;

        &.active {
          background: blue;
        }

        &.size-small {
          padding: 4px;
        }
      \`;

      function Component() {
        return (
          <Box active size="small" css={\`color: red;\`}>
            Content
          </Box>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component() {
      return (
        <div className="v1560qbr-1-Box voctcyj-active vr4ikfs-size-small v1560qbr-2-css-prop-2">
          Content
        </div>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      padding: 8px;

      &.voctcyj-active {
        background: blue;
      }

      &.vr4ikfs-size-small {
        padding: 4px;
      }
    }

    .v1560qbr-2-css-prop-2 {
      color: red;
    }
    "
  `);
});

test('should merge dynamic style flags into the css prop className', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div<{ active: boolean; size: 'small' | 'large' }>\`
        padding: 8px;

        &.active {
          background: blue;
        }

        &.size-small {
          padding: 4px;
        }
      \`;

      function Component({ isActive, size }) {
        return (
          <Box active={isActive} size={size} css={\`color: red;\`}>
            Content
          </Box>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ isActive, size }) {
      return (
        <div
          className={
            "v1560qbr-1-Box v1560qbr-2-css-prop-2" +
            (isActive ? " voctcyj-active" : "") +
            (size ? " vr4ikfs-size-" + size : "")
          }
        >
          Content
        </div>
      );
    }
    "
  `);
});

test('should merge style flags into the cx prop className', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div<{ active: boolean; size: 'small' | 'large' }>\`
        padding: 8px;

        &.active {
          background: blue;
        }

        &.highlighted {
          border: 1px solid yellow;
        }
      \`;

      function Component({ isActive, isHighlighted }) {
        return (
          <Box active={isActive} size="large" cx={{ highlighted: isHighlighted }}>
            Content
          </Box>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component({ isActive, isHighlighted }) {
      return (
        <div
          className={
            "v1560qbr-1-Box vr4ikfs-size-large" +
            (isActive ? " voctcyj-active" : "") +
            " " +
            cx({
              "v1560qbr-2-highlighted": isHighlighted,
            })
          }
        >
          Content
        </div>
      );
    }
    "
  `);
});

test('should merge style flags into the css and cx prop className with a className', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div<{ active: boolean }>\`
        padding: 8px;

        &.active {
          background: blue;
        }
      \`;

      function Component({ isActive, isOpen, className }) {
        return (
          <>
            <Box active className="extra" css={\`color: red;\`} />
            <Box active={isActive} className={className} css={\`color: blue;\`} />
            <Box
              active={isActive}
              className="extra"
              cx={{ open: isOpen }}
              css={\`&.open { color: green; }\`}
            />
          </>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component({ isActive, isOpen, className }) {
      return (
        <>
          <div className="extra v1560qbr-1-Box voctcyj-active v1560qbr-2-css-prop-2" />
          <div
            className={
              (className || "") +
              " v1560qbr-1-Box v1560qbr-3-css-prop-3" +
              (isActive ? " voctcyj-active" : "")
            }
          />
          <div
            className={
              "extra v1560qbr-1-Box v1560qbr-4-css-prop-4" +
              (isActive ? " voctcyj-active" : "") +
              " " +
              cx({
                "v1560qbr-5-open": isOpen,
              })
            }
          />
        </>
      );
    }
    "
  `);
});
