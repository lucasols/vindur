import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../../testUtils';

describe('JSX dynamic color transform', () => {
  describe('prop order independence', () => {
    test('should handle className before dynamicColor', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur';

          const color = createDynamicCssColor();

          function Component() {
            return <div className="test-class" dynamicColor={color} />;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { createDynamicCssColor } from "vindur";
        const color = createDynamicCssColor("v1560qbr-1", true);
        function Component() {
          return (
            <div
              {...color._sp("#ff6b6b", {
                className: "test-class",
              })}
            />
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`""`);
    });

    test('should handle className after dynamicColor', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur';

          const color = createDynamicCssColor();

          function Component() {
            return <div dynamicColor={color} className="test-class" />;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { createDynamicCssColor } from "vindur";
        const color = createDynamicCssColor("v1560qbr-1", true);
        function Component() {
          return (
            <div
              {...color._sp("#ff6b6b", {
                className: "test-class",
              })}
            />
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`""`);
    });

    test('should handle style before dynamicColor', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur';

          const color = createDynamicCssColor();

          function Component() {
            return <div style={{ padding: '10px' }} dynamicColor={color} />;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { createDynamicCssColor } from "vindur";
        const color = createDynamicCssColor("v1560qbr-1", true);
        function Component() {
          return (
            <div
              {...color._sp("#ff6b6b", {
                style: {
                  padding: "10px",
                },
              })}
            />
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`""`);
    });

    test('should handle style after dynamicColor', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur';

          const color = createDynamicCssColor();

          function Component() {
            return <div dynamicColor={color} style={{ padding: '10px' }} />;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { createDynamicCssColor } from "vindur";
        const color = createDynamicCssColor("v1560qbr-1", true);
        function Component() {
          return (
            <div
              {...color._sp("#ff6b6b", {
                style: {
                  padding: "10px",
                },
              })}
            />
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`""`);
    });

    test('should handle both className and style before dynamicColor', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur';

          const color = createDynamicCssColor();

          function Component() {
            return <div className="test-class" style={{ padding: '10px' }} dynamicColor={color} />;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { createDynamicCssColor } from "vindur";
        const color = createDynamicCssColor("v1560qbr-1", true);
        function Component() {
          return (
            <div
              {...color._sp("#ff6b6b", {
                className: "test-class",
                style: {
                  padding: "10px",
                },
              })}
            />
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`""`);
    });

    test('should handle both className and style after dynamicColor', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur';

          const color = createDynamicCssColor();

          function Component() {
            return <div dynamicColor={color} className="test-class" style={{ padding: '10px' }} />;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { createDynamicCssColor } from "vindur";
        const color = createDynamicCssColor("v1560qbr-1", true);
        function Component() {
          return (
            <div
              {...color._sp("#ff6b6b", {
                className: "test-class",
                style: {
                  padding: "10px",
                },
              })}
            />
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`""`);
    });

    test('should handle mixed order - className before, style after dynamicColor', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur';

          const color = createDynamicCssColor();

          function Component() {
            return <div className="test-class" dynamicColor={color} style={{ padding: '10px' }} />;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { createDynamicCssColor } from "vindur";
        const color = createDynamicCssColor("v1560qbr-1", true);
        function Component() {
          return (
            <div
              {...color._sp("#ff6b6b", {
                className: "test-class",
                style: {
                  padding: "10px",
                },
              })}
            />
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`""`);
    });

    test('should handle mixed order - style before, className after dynamicColor', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur';

          const color = createDynamicCssColor();

          function Component() {
            return <div style={{ padding: '10px' }} dynamicColor={color} className="test-class" />;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { createDynamicCssColor } from "vindur";
        const color = createDynamicCssColor("v1560qbr-1", true);
        function Component() {
          return (
            <div
              {...color._sp("#ff6b6b", {
                className: "test-class",
                style: {
                  padding: "10px",
                },
              })}
            />
          );
        }
        "
      `);

      expect(result.css).toMatchInlineSnapshot(`""`);
    });
  });

  describe('dynamic color.set() prop order independence', () => {
    test('should handle className before dynamicColor.set()', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur';

          const color = createDynamicCssColor();

          function Component({ condition }: { condition: boolean }) {
            return <div className="test-class" dynamicColor={color.set(condition ? '#ff0000' : null)} />;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { createDynamicCssColor } from "vindur";
        const color = createDynamicCssColor("v1560qbr-1", true);
        function Component({ condition }: { condition: boolean }) {
          return (
            <div
              {...color._sp(condition ? "#ff0000" : null, {
                className: "test-class",
              })}
            />
          );
        }
        "
      `);
    });

    test('should handle className after dynamicColor.set()', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur';

          const color = createDynamicCssColor();

          function Component({ condition }: { condition: boolean }) {
            return <div dynamicColor={color.set(condition ? '#ff0000' : null)} className="test-class" />;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { createDynamicCssColor } from "vindur";
        const color = createDynamicCssColor("v1560qbr-1", true);
        function Component({ condition }: { condition: boolean }) {
          return (
            <div
              {...color._sp(condition ? "#ff0000" : null, {
                className: "test-class",
              })}
            />
          );
        }
        "
      `);
    });
  });

  describe('multiple dynamic colors prop order independence', () => {
    test('should handle className before multiple dynamicColors', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur';

          const color1 = createDynamicCssColor();
          const color2 = createDynamicCssColor();

          function Component() {
            return <div className="test-class" dynamicColor={[color1, color2]} />;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { createDynamicCssColor } from "vindur";
        const color1 = createDynamicCssColor("v1560qbr-1", true);
        const color2 = createDynamicCssColor("v1560qbr-2", true);
        function Component() {
          return (
            <div
              {...color1._sp(
                "#ff6b6b",
                color2._sp("#ff6b6b", {
                  className: "test-class",
                }),
              )}
            />
          );
        }
        "
      `);
    });

    test('should handle className after multiple dynamicColors', async () => {
      const result = await transformWithFormat({
        source: dedent`
          import { createDynamicCssColor } from 'vindur';

          const color1 = createDynamicCssColor();
          const color2 = createDynamicCssColor();

          function Component() {
            return <div dynamicColor={[color1, color2]} className="test-class" />;
          }
        `,
      });

      expect(result.code).toMatchInlineSnapshot(`
        "import { createDynamicCssColor } from "vindur";
        const color1 = createDynamicCssColor("v1560qbr-1", true);
        const color2 = createDynamicCssColor("v1560qbr-2", true);
        function Component() {
          return (
            <div
              {...color1._sp(
                "#ff6b6b",
                color2._sp("#ff6b6b", {
                  className: "test-class",
                }),
              )}
            />
          );
        }
        "
      `);
    });
  });
});
