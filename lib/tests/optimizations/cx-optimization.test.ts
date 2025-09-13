import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

describe('cx() optimization', () => {
  describe('fully static optimization', () => {
    test('should optimize cx with only string literals', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component() {
            return <div className={cx("class1", "class2", "class3")}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component() {
          return <div className={"class1 class2 class3"}>Content</div>;
        }
        "
      `);
    });

    test('should optimize cx with falsy values', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component() {
            return <div className={cx("class1", false, null, undefined, "", "class2")}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component() {
          return <div className={"class1 class2"}>Content</div>;
        }
        "
      `);
    });

    test('should optimize cx with object containing only literal booleans', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component() {
            return <div className={cx({ active: true, disabled: false, loading: true })}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component() {
          return <div className={"active loading"}>Content</div>;
        }
        "
      `);
    });

    test('should optimize cx with mixed static values', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component() {
            return <div className={cx("base", { active: true, disabled: false }, "extra")}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component() {
          return <div className={"base" + " active extra"}>Content</div>;
        }
        "
      `);
    });

    test('should handle empty cx call', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component() {
            return <div className={cx()}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component() {
          return <div className={""}>Content</div>;
        }
        "
      `);
    });

    test('should handle cx with only falsy values', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component() {
            return <div className={cx(false, null, undefined, "")}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component() {
          return <div className={""}>Content</div>;
        }
        "
      `);
    });
  });

  describe('partial optimization with dynamic values', () => {
    test('should optimize logical expressions with static strings', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ isActive, isDisabled }) {
            return (
              <div className={cx("base", isActive && "active", isDisabled && "disabled")}>
                Content
              </div>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ isActive, isDisabled }) {
          return (
            <div
              className={
                "base" + (isActive ? " active" : "") + (isDisabled ? " disabled" : "")
              }
            >
              Content
            </div>
          );
        }
        "
      `);
    });

    test('should optimize object with dynamic boolean properties', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ isActive, isDisabled }) {
            return (
              <div className={cx({ active: isActive, disabled: isDisabled })}>
                Content
              </div>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ isActive, isDisabled }) {
          return (
            <div
              className={(isActive ? "active" : "") + (isDisabled ? " disabled" : "")}
            >
              Content
            </div>
          );
        }
        "
      `);
    });

    test('should optimize mixed static and dynamic patterns', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ isActive, isDisabled }) {
            return (
              <div className={cx("base", { active: isActive, loading: true, disabled: isDisabled })}>
                Content
              </div>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ isActive, isDisabled }) {
          return (
            <div
              className={
                "base" +
                (" loading" +
                  (isActive ? " active" : "") +
                  (isDisabled ? " disabled" : ""))
              }
            >
              Content
            </div>
          );
        }
        "
      `);
    });

    test('should optimize with single dynamic expression', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ isActive }) {
            return (
              <div className={cx(isActive && "active")}>
                Content
              </div>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ isActive }) {
          return <div className={isActive ? "active" : ""}>Content</div>;
        }
        "
      `);
    });
  });

  describe('template literal optimization', () => {
    test('should optimize logical expressions with template literals', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ value, active }) {
            return (
              <div className={cx(
                "v1560qbr-1-Btn",
                value && \`v3j7qq4-value-\${value}\`,
                active && "voctcyj-active",
              )}>
                Content
              </div>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ value, active }) {
          return (
            <div
              className={
                "v1560qbr-1-Btn" +
                (value ? " v3j7qq4-value-" + value : "") +
                (active ? " voctcyj-active" : "")
              }
            >
              Content
            </div>
          );
        }
        "
      `);
    });

    test('should optimize template literal with prefix only', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ size }) {
            return <div className={cx(size && \`size-\${size}\`)}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ size }) {
          return <div className={size ? "size-" + size : ""}>Content</div>;
        }
        "
      `);
    });

    test('should optimize template literal with suffix only', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ type }) {
            return <div className={cx(type && \`\${type}-variant\`)}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ type }) {
          return <div className={type ? type + "-variant" : ""}>Content</div>;
        }
        "
      `);
    });

    test('should optimize template literal with both prefix and suffix', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ theme }) {
            return <div className={cx(theme && \`theme-\${theme}-active\`)}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ theme }) {
          return (
            <div className={theme ? "theme-" + theme + "-active" : ""}>Content</div>
          );
        }
        "
      `);
    });

    test('should optimize mixed static strings and template literals', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ variant, active }) {
            return (
              <div className={cx(
                "base-class",
                variant && \`variant-\${variant}\`,
                active && "active-state"
              )}>
                Content
              </div>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ variant, active }) {
          return (
            <div
              className={
                "base-class" +
                (variant ? " variant-" + variant : "") +
                (active ? " active-state" : "")
              }
            >
              Content
            </div>
          );
        }
        "
      `);
    });
  });

  describe('style flags optimization (common Vindur patterns)', () => {
    test('should optimize cx with Vindur-generated class names', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component() {
            return <div className={cx("v1560qbr-1", "voctcyj")}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component() {
          return <div className={"v1560qbr-1 voctcyj"}>Content</div>;
        }
        "
      `);
    });

    test('should optimize cx with base class and conditional modifier', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ active }) {
            return <div className={cx("v1560qbr-1-Button", active && "voctcyj-active")}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ active }) {
          return (
            <div className={"v1560qbr-1-Button" + (active ? " voctcyj-active" : "")}>
              Content
            </div>
          );
        }
        "
      `);
    });

    test('should optimize cx with multiple conditional modifiers', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ active, disabled, loading }) {
            return (
              <div className={cx(
                "v1560qbr-1-Card",
                active && "voctcyj-active",
                disabled && "v1iz0um9-disabled",
                loading && "vloading-loading"
              )}>
                Content
              </div>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ active, disabled, loading }) {
          return (
            <div
              className={
                "v1560qbr-1-Card" +
                (active ? " voctcyj-active" : "") +
                (disabled ? " v1iz0um9-disabled" : "") +
                (loading ? " vloading-loading" : "")
              }
            >
              Content
            </div>
          );
        }
        "
      `);
    });
  });

  describe('edge cases that should NOT optimize', () => {
    test('should not optimize cx with spread arguments', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ classes }) {
            return <div className={cx("base", ...classes)}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { cx } from "vindur";
        function Component({ classes }) {
          return <div className={cx("base", ...classes)}>Content</div>;
        }
        "
      `);
    });

    test('should not optimize cx with array variable', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component() {
            const classes = ["dynamic", "array"];
            return <div className={cx(classes)}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { cx } from "vindur";
        function Component() {
          const classes = ["dynamic", "array"];
          return <div className={cx(classes)}>Content</div>;
        }
        "
      `);
    });

    test('should not optimize cx with complex expressions', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ condition, obj1, obj2 }) {
            return <div className={cx(condition ? obj1 : obj2)}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { cx } from "vindur";
        function Component({ condition, obj1, obj2 }) {
          return <div className={cx(condition ? obj1 : obj2)}>Content</div>;
        }
        "
      `);
    });

    test('should not optimize cx with computed object properties', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ className }) {
            return <div className={cx({ [className]: true })}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { cx } from "vindur";
        function Component({ className }) {
          return (
            <div
              className={cx({
                [className]: true,
              })}
            >
              Content
            </div>
          );
        }
        "
      `);
    });

    test('should not optimize cx with function calls', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ getClassName }) {
            return <div className={cx(getClassName())}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { cx } from "vindur";
        function Component({ getClassName }) {
          return <div className={cx(getClassName())}>Content</div>;
        }
        "
      `);
    });

    test('should not optimize cx with complex logical expressions', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ a, b, c }) {
            return <div className={cx(a && b && c && "complex")}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ a, b, c }) {
          return <div className={a && b && c ? "complex" : ""}>Content</div>;
        }
        "
      `);
    });
  });

  describe('integration with string concatenation', () => {
    test('should optimize cx when part of string concatenation', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component() {
            return (
              <div className={"base-class " + cx("class1", "class2")}>
                Content
              </div>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component() {
          return <div className={"base-class " + "class1 class2"}>Content</div>;
        }
        "
      `);
    });

    test('should optimize cx in template literals', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component() {
            return (
              <div className={\`base-class \${cx("class1", "class2")}\`}>
                Content
              </div>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component() {
          return <div className={\`base-class \${"class1 class2"}\`}>Content</div>;
        }
        "
      `);
    });
  });

  describe('import cleanup', () => {
    test('should remove cx import when all cx calls are optimized', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component() {
            return (
              <div>
                <span className={cx("class1", "class2")}>Span</span>
                <p className={cx("class3", "class4")}>Paragraph</p>
              </div>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component() {
          return (
            <div>
              <span className={"class1 class2"}>Span</span>
              <p className={"class3 class4"}>Paragraph</p>
            </div>
          );
        }
        "
      `);
    });

    test('should keep cx import when some cx calls cannot be optimized', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ dynamicClasses }) {
            return (
              <div>
                <span className={cx("class1", "class2")}>Optimized</span>
                <p className={cx(dynamicClasses)}>Not optimized</p>
              </div>
            );
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { cx } from "vindur";
        function Component({ dynamicClasses }) {
          return (
            <div>
              <span className={"class1 class2"}>Optimized</span>
              <p className={cx(dynamicClasses)}>Not optimized</p>
            </div>
          );
        }
        "
      `);
    });
  });

  describe('variable assignments', () => {
    test('should optimize cx in variable assignments', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          function Component({ isActive }) {
            const className = cx("base", isActive && "active");
            return <div className={className}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "function Component({ isActive }) {
          const className = "base" + (isActive ? " active" : "");
          return <div className={className}>Content</div>;
        }
        "
      `);
    });

    test('should optimize cx in const declarations', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { cx } from 'vindur';

          const staticClassName = cx("class1", "class2", "class3");

          function Component() {
            return <div className={staticClassName}>Content</div>;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "const staticClassName = "class1 class2 class3";
        function Component() {
          return <div className={staticClassName}>Content</div>;
        }
        "
      `);
    });
  });
});