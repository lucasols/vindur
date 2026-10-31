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
        <div className="v1560qbr-1-Box v1560qbr-1-Box-active v1560qbr-1-Box-size-small v1560qbr-2-css-prop-2">
          Content
        </div>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      padding: 8px;

      &.v1560qbr-1-Box-active {
        background: blue;
      }

      &.v1560qbr-1-Box-size-small {
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
            (isActive ? " v1560qbr-1-Box-active" : "") +
            (size ? " v1560qbr-1-Box-size-" + size : "")
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
    "function Component({ isActive, isHighlighted }) {
      return (
        <div
          className={
            "v1560qbr-1-Box v1560qbr-1-Box-size-large" +
            (isActive ? " v1560qbr-1-Box-active" : "") +
            (isHighlighted ? " v1560qbr-2-highlighted" : "")
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
    "function Component({ isActive, isOpen, className }) {
      return (
        <>
          <div className="extra v1560qbr-1-Box v1560qbr-1-Box-active v1560qbr-2-css-prop-2" />
          <div
            className={
              (className || "") +
              " v1560qbr-1-Box v1560qbr-3-css-prop-3" +
              (isActive ? " v1560qbr-1-Box-active" : "")
            }
          />
          <div
            className={
              "extra v1560qbr-1-Box v1560qbr-4-css-prop-4" +
              (isActive ? " v1560qbr-1-Box-active" : "") +
              (isOpen ? " v1560qbr-5-open" : "")
            }
          />
        </>
      );
    }
    "
  `);
});

test('should throw for style flag classes selected in the css prop', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Box = styled.div<{ active: boolean }>\`
          &.active { color: red; }
        \`

        export const App = ({ on }) => <Box active={on} css={\`&.active { color: blue; }\`} />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag class \`active\` of \`Box\` can't be selected in its css prop, the element gets the hashed flag class, style it in the styles of \`Box\`
    loc: 7:53]
  `);
});

test('should throw for style flag classes selected by a css reference in the css prop', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css, styled } from 'vindur'

        const Box = styled.div<{ active: boolean }>\`
          &.active { color: red; }
        \`

        const extra = css\`
          &.active { color: blue; }
        \`

        export const App = ({ on }) => <Box active={on} css={extra} />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Style flag class \`active\` of \`Box\` can't be selected in its css prop, the element gets the hashed flag class, style it in the styles of \`Box\`
    loc: 11:53]
  `);
});
