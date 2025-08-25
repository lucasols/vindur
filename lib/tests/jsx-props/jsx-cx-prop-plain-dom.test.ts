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
      "cx prop on plain DOM elements requires classes to use $ prefix (e.g., $className) when not used with css prop or styled components. This ensures you're referencing external CSS classes.",
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
      "cx prop on plain DOM elements requires classes to use $ prefix (e.g., $className) when not used with css prop or styled components. This ensures you're referencing external CSS classes.",
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
