import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('JSX cx prop on plain DOM elements without CSS context', () => {
  test('should throw error when using cx prop on plain DOM element without $ prefix', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ isActive }) {
            return <div cx={{ active: isActive }} />;
          }
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: cx prop on plain DOM elements requires classes to use $ prefix (e.g., $className) when not used with css prop or styled components. This ensures you're referencing external CSS classes.
      loc: 4:14]
    `,
    );
  });

  test('should throw error when mixing $ prefix and non-$ prefix classes on plain DOM element', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ isActive, hasError }) {
            return <div cx={{ active: isActive, $error: hasError }} />;
          }
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [TransformError: /test.tsx: cx prop on plain DOM elements requires classes to use $ prefix (e.g., $className) when not used with css prop or styled components. This ensures you're referencing external CSS classes.
      loc: 4:14]
    `,
    );
  });

  test('should allow cx prop on plain DOM element when all classes use $ prefix', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { cx } from 'vindur';

        function Component({ isActive, hasError }) {
          return <div cx={{ $active: isActive, $error: hasError }} />;
        }
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { cx } from "vindur";
      function Component({ isActive, hasError }) {
        return (
          <div className={(isActive ? "active" : "") + (hasError ? " error" : "")} />
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });

  test('should allow cx prop on plain DOM element with existing className when all cx classes use $ prefix', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { cx } from 'vindur';

        function Component({ isActive, hasError }) {
          return <div className="base-class" cx={{ $active: isActive, $error: hasError }} />;
        }
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { cx } from "vindur";
      function Component({ isActive, hasError }) {
        return (
          <div
            className={
              "base-class" + (isActive ? " active" : "") + (hasError ? " error" : "")
            }
          />
        );
      }
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`""`);
  });
});

test('should escape quotes in pass-through cx class names', async () => {
  const result = await transformWithFormat({
    source: dedent`
      function Component({ active }) {
        return <div cx={{ '$after:content-["hello"]': active }} />;
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ active }) {
      return <div className={active ? 'after:content-["hello"]' : ""} />;
    }
    "
  `);
});

test('should throw for getters and methods in cx objects', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        function Component({ active }) {
          return <div cx={{ get $active() { return active; } }} />;
        }
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop object must only contain \`key: value\` properties, not methods, getters or setters
    loc: 2:20]
  `);
});

test('should reject empty cx objects', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        export const App = () => <div cx={{}} />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop object must not be empty, remove the cx prop instead
    loc: 1:34]
  `);
});

test('should throw for cx keys that are not plain class names', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        export const App = ({ active }) => <div cx={{ $__proto__: active }} />;
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop key "$__proto__" must be a single class name, use one key per class, eg. { $first: on, $second: on }
    loc: 1:46]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur';

        export const App = ({ active }) => (
          <div css={\`color: red;\`} cx={{ 'is active': active }} />
        );
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop key "is active" must be a plain class name with letters, digits, - and _, not starting with a digit, eg. { active: on }, or a $-prefixed external class
    loc: 4:33]
  `);
});

test('should keep transformed code inside cx values', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { stableId } from 'vindur';

      export const App = ({ id }) => <div cx={{ $selected: id === stableId() }} />;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const App = ({ id }) => (
      <div className={id === "v1560qbr-1" ? "selected" : ""} />
    );
    "
  `);
});

test('should keep JSX string class names when merging generated classes', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'

      function Component({ isActive }) {
        return (
          <>
            <div
              className="a
                b"
              css={\`color: red;\`}
            />
            <div className='q"z &amp; y' cx={{ $active: isActive }} />
          </>
        );
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "function Component({ isActive }) {
      return (
        <>
          <div
            className="a
              b v1560qbr-1-css-prop-1"
          />
          <div className={'q"z & y' + (isActive ? " active" : "")} />
        </>
      );
    }
    "
  `);
});
