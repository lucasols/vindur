import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should merge css prop and cx prop with an existing className', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx } from 'vindur';

      function Component({ isActive, extra }) {
        return (
          <>
            <div
              className="base"
              cx={{ active: isActive }}
              css={\`
                color: red;
                &.active { color: blue; }
              \`}
            />
            <div
              className={extra}
              cx={{ active: isActive }}
              css={\`
                color: green;
                &.active { color: blue; }
              \`}
            />
          </>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component({ isActive, extra }) {
      return (
        <>
          <div
            className={
              "base v1560qbr-1-css-prop-1 " +
              cx({
                "v1560qbr-2-active": isActive,
              })
            }
          />
          <div
            className={[
              extra,
              "v1560qbr-3-css-prop-3 " +
                cx({
                  "v1560qbr-4-active": isActive,
                }),
            ]
              .filter(Boolean)
              .join(" ")}
          />
        </>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-css-prop-1 {
      color: red;
      &.v1560qbr-2-active {
        color: blue;
      }
    }

    .v1560qbr-3-css-prop-3 {
      color: green;
      &.v1560qbr-4-active {
        color: blue;
      }
    }
    "
  `);
});

test('should keep multiline and escaped className strings valid when merging cx classes', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx } from 'vindur';

      function Component({ isActive }) {
        return (
          <>
            <div
              className="base
                a\\b &amp; c"
              cx={{ active: isActive }}
              css={\`
                color: red;
                &.active { color: blue; }
              \`}
            />
            <div
              className="plain
                other"
              cx={{ $active: isActive }}
            />
          </>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component({ isActive }) {
      return (
        <>
          <div
            className={
              "base\\n          a\\\\\\\\b & c v1560qbr-1-css-prop-1 " +
              cx({
                "v1560qbr-2-active": isActive,
              })
            }
          />
          <div
            className={
              "plain\\n          other " +
              cx({
                active: isActive,
              })
            }
          />
        </>
      );
    }
    "
  `);
});

test('should merge explicit className with spread props', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';

      function Component({ isActive, next, count, extra, ...props }) {
        return (
          <>
            <div {...props} className="base" css={\`color: red;\`} />
            <div
              {...props}
              className={isActive ? 'on' : undefined}
              cx={{ $active: isActive }}
            />
            <div
              {...props}
              className={next()}
              data-count={count}
              css={\`color: blue;\`}
            />
            <div
              {...props}
              className={css\`color: green;\`}
              cx={{ $active: isActive }}
            />
            <div className={extra} {...props} css={\`color: gray;\`} />
          </>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx, mergeClassNames } from "vindur";
    function Component({ isActive, next, count, extra, ...props }) {
      return (
        <>
          <div {...props} className="base v1560qbr-1-css-prop-1" />
          <div
            {...props}
            className={[
              isActive ? "on" : undefined,
              cx({
                active: isActive,
              }),
            ]
              .filter(Boolean)
              .join(" ")}
          />
          <div
            {...props}
            className={[next(), "v1560qbr-2-css-prop-2"].filter(Boolean).join(" ")}
            data-count={count}
          />
          <div
            {...props}
            className={[
              "v1560qbr-4",
              cx({
                active: isActive,
              }),
            ]
              .filter(Boolean)
              .join(" ")}
          />
          <div
            {...props}
            className={mergeClassNames(
              [
                {
                  className: extra,
                },
                props,
              ],
              "v1560qbr-3-css-prop-3",
            )}
          />
        </>
      );
    }
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-4 {
      color: green;
    }

    .v1560qbr-1-css-prop-1 {
      color: red;
    }

    .v1560qbr-2-css-prop-2 {
      color: blue;
    }

    .v1560qbr-3-css-prop-3 {
      color: gray;
    }
    "
  `);
});

test('should merge styled component class names with an explicit className before spread props', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        color: red;
      \`;

      function Component({ extra, ...props }) {
        return <Box className={extra} {...props} />;
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { mergeClassNames } from "vindur";
    function Component({ extra, ...props }) {
      return (
        <div
          {...props}
          className={mergeClassNames(
            [
              {
                className: extra,
              },
              props,
            ],
            "v1560qbr-1-Box",
          )}
        />
      );
    }
    "
  `);
});

test('should keep the quotes of single quoted className strings', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        color: red;
      \`;

      function Component() {
        return (
          <>
            <div className='say "hi"' css={\`color: red;\`} />
            <Box className='say "hi"' />
          </>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component() {
      return (
        <>
          <div className='say "hi" v1560qbr-2-css-prop-2' />
          <div className='v1560qbr-1-Box say "hi"' />
        </>
      );
    }
    "
  `);
});

test('should throw for dynamicColor with className and css prop', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createDynamicCssColor } from 'vindur';

        const color = createDynamicCssColor();

        function Component({ value }) {
          return (
            <div
              className="base"
              css={\`color: \${color.var};\`}
              dynamicColor={color.set(value)}
            />
          );
        }
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: dynamicColor can't be combined with both className and the css or cx prop on the same element
    loc: 8:6]
  `);
});

test('should keep the user cx import when generated classes still call cx', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx, styled } from 'vindur';

      const Btn = styled.button\`
        color: red;
        &.active { color: blue; }
      \`;

      function Component({ big, active }) {
        return <Btn className={cx('base', { big })} cx={{ active }} />;
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    function Component({ big, active }) {
      return (
        <button
          className={[
            "base" + (big ? " big" : ""),
            "v1560qbr-1-Btn " +
              cx({
                "v1560qbr-2-active": active,
              }),
          ]
            .filter(Boolean)
            .join(" ")}
        />
      );
    }
    "
  `);
});

test('should inject the cx helper when the user imports cx under an alias', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx as classNames } from 'vindur';

      function Component({ active }) {
        return <circle className={classNames('base')} cx={{ $active: active }} />;
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx, cx as classNames } from "vindur";
    function Component({ active }) {
      return (
        <circle
          className={[
            classNames("base"),
            cx({
              active: active,
            }),
          ]
            .filter(Boolean)
            .join(" ")}
        />
      );
    }
    "
  `);
});

test('should keep the user cx import while it has references besides optimized calls', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { cx } from 'vindur';

      const joinClasses = cx;
      const base = cx('base');

      export const Component = () => <div className={base} data-join={joinClasses} />;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    const joinClasses = cx;
    const base = "base";
    export const Component = () => <div className={base} data-join={joinClasses} />;
    "
  `);
});

test('should import helpers under an alias when another binding uses their name', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import cx from 'classnames';

      export const Component = ({ active }) => (
        <div className={cx('base')} cx={{ $active: active }} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx as _vCx } from "vindur";
    import cx from "classnames";
    export const Component = ({ active }) => (
      <div
        className={[
          cx("base"),
          _vCx({
            active: active,
          }),
        ]
          .filter(Boolean)
          .join(" ")}
      />
    );
    "
  `);
});

test('should not let a type-only cx import stand in for the cx helper', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import type { cx } from 'vindur';

      export const Component = ({ active }) => <div cx={{ $active: active }} />;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx as _vCx } from "vindur";
    import type { cx } from "vindur";
    export const Component = ({ active }) => (
      <div
        className={_vCx({
          active: active,
        })}
      />
    );
    "
  `);
});

test('should insert className before the end of the opening tag after comments', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const App = ({ p, c }) => (
        <>
          <div {...p} cx={{ $a: c }} /* note */></div>
          <div {...p} css={\`color: red;\`} / >
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx, mergeClassNames } from "vindur";
    export const App = ({ p, c }) => (
      <>
        <div
          {...p}
          /* note */ className={mergeClassNames(
            [p],
            cx({
              a: c,
            }),
          )}
        ></div>
        <div {...p} className={mergeClassNames([p], "v1560qbr-1-css-prop-1")} />
      </>
    );
    "
  `);
});

test('should throw for dynamicColor before a transformed prop with spread props', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled, createDynamicCssColor } from 'vindur';

        const color = createDynamicCssColor();
        const Box = styled.div\`&.on { color: blue; }\`;

        export const App = ({ p, v, x }) => (
          <Box {...p} dynamicColor={color.set(v)} cx={{ on: x }} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: dynamicColor can't be combined with this cx prop on the same element, vindur also transforms it. Place dynamicColor after it
    loc: 7:42]
  `);
});

test('should throw for dynamicColor with a transformed style prop', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled, createDynamicCssColor } from 'vindur';

        const color = createDynamicCssColor();
        const Box = styled.div\`---offset: 1px; left: var(---offset);\`;

        export const App = ({ x, v }) => (
          <Box style={{ '---offset': x }} dynamicColor={color.set(v)} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: dynamicColor can't be combined with this style prop on the same element, vindur also transforms it
    loc: 7:7]
  `);
});
