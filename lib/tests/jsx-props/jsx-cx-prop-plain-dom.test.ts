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
          <div
            className={cx({
              active: isActive,
              error: hasError,
            })}
          />
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
              "base-class " +
              cx({
                active: isActive,
                error: hasError,
              })
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
    "import { cx } from "vindur";
    function Component({ active }) {
      return (
        <div
          className={cx({
            'after:content-["hello"]': active,
          })}
        />
      );
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

test('should handle empty cx objects and __proto__ class names', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const App = ({ active }) => (
        <>
          <div cx={{}} />
          <div cx={{ $__proto__: active, $other: true }} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const App = ({ active }) => (
      <>
        <div className={cx({})} />
        <div
          className={cx({
            ["__proto__"]: active,
            other: true,
          })}
        />
      </>
    );
    "
  `);
});
