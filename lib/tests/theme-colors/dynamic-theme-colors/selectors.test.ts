import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transformWithFormat } from '../../testUtils';

describe('Dynamic Colors - Conditional Selectors', () => {
  test('should transform basic dynamic color usage with dev mode selectors', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const dynamicColor = createDynamicCssColor()

      const Container = styled.div\`
        background: \${dynamicColor.var};
        color: \${dynamicColor.contrast.var};

        \${dynamicColor.self.isDark} {
          border: 2px solid white;
        }

        \${dynamicColor.self.isLight} {
          border: 2px solid black;
        }
      \`

      const Component = () => {
        return (
          <div dynamicColor={dynamicColor}>
            <Container>Dev mode content</Container>
          </div>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const dynamicColor = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return (
          <div {...dynamicColor._sp("#ff6b6b")}>
            <div className="v1560qbr-2-Container">Dev mode content</div>
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-Container {
        background: var(--v1560qbr-1);
        color: var(--v1560qbr-1-c);

        &.v1560qbr-1-s0 {
          border: 2px solid white;
        }

        &.v1560qbr-1-s1 {
          border: 2px solid black;
        }
      }"
    `);
  });

  test('should transform container conditional selectors', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Card = styled.div\`
        background: white;
        padding: 20px;

        \${color.container.isLight} & {
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        \${color.container.isDark} & {
          box-shadow: 0 2px 8px rgba(255,255,255,0.1);
        }

        \${color.container.isDefined} & {
          border-radius: 8px;
        }

        \${color.container.isNotDefined} & {
          border: 1px solid #ccc;
        }
      \`

      const Component = () => {
        return (
          <div dynamicColor={color}>
            <Card>Card content</Card>
          </div>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return (
          <div {...color._sp("#ff6b6b")}>
            <div className="v1560qbr-2-Card">Card content</div>
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-Card {
        background: white;
        padding: 20px;

        .v1560qbr-1-c1 & {
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .v1560qbr-1-c0 & {
          box-shadow: 0 2px 8px rgba(255,255,255,0.1);
        }

        .v1560qbr-1-c2 & {
          border-radius: 8px;
        }

        .v1560qbr-1-c3 & {
          border: 1px solid #ccc;
        }
      }"
    `);
  });

  test('should transform dynamic color with all conditional selectors', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const ComplexComponent = styled.div\`
        background: \${color.var};

        \${color.self.isDark} {
          color: white;
        }

        \${color.self.isLight} {
          color: black;
        }

        \${color.self.isDefined} {
          border: 1px solid;
        }

        \${color.self.isNotDefined} {
          border: 1px dashed #ccc;
        }

        \${color.self.isVeryDark} {
          font-weight: bold;
        }

        \${color.self.isNotVeryDark} {
          font-weight: normal;
        }

        \${color.self.isVeryLight} {
          text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
        }

        \${color.self.isNotVeryLight} {
          text-shadow: none;
        }
      \`

      const Component = () => {
        return <ComplexComponent dynamicColor={color}>All selectors test</ComplexComponent>;
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return (
          <div
            {...color._sp("#ff6b6b", {
              className: "v1560qbr-2-ComplexComponent",
            })}
          >
            All selectors test
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-ComplexComponent {
        background: var(--v1560qbr-1);

        &.v1560qbr-1-s0 {
          color: white;
        }

        &.v1560qbr-1-s1 {
          color: black;
        }

        &.v1560qbr-1-s2 {
          border: 1px solid;
        }

        &.v1560qbr-1-s3 {
          border: 1px dashed #ccc;
        }

        &.v1560qbr-1-s4 {
          font-weight: bold;
        }

        &.v1560qbr-1-s5 {
          font-weight: normal;
        }

        &.v1560qbr-1-s6 {
          text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
        }

        &.v1560qbr-1-s7 {
          text-shadow: none;
        }
      }"
    `);
  });

  test('should transform mixed self and container selectors in nested elements', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Card = styled.div\`
        padding: 20px;

        .title {
          font-size: 24px;

          \${color.container.isLight} & {
            color: #333;
          }

          \${color.container.isDark} & {
            color: #fff;
          }
        }

        .content {
          margin-top: 16px;

          \${color.container.isDefined} & {
            opacity: 1;
          }

          \${color.container.isNotDefined} & {
            opacity: 0.7;
          }
        }
      \`

      const Component = () => {
        return (
          <div dynamicColor={color}>
            <Card>
              <div className="title">Title</div>
              <div className="content">Content</div>
            </Card>
          </div>
        );
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1");
      const Component = () => {
        return (
          <div {...color._sp("#ff6b6b")}>
            <div className="v1560qbr-2-Card">
              <div className="title">Title</div>
              <div className="content">Content</div>
            </div>
          </div>
        );
      };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-2-Card {
        padding: 20px;

        .title {
          font-size: 24px;

          .v1560qbr-1-c1 & {
            color: #333;
          }

          .v1560qbr-1-c0 & {
            color: #fff;
          }
        }

        .content {
          margin-top: 16px;

          .v1560qbr-1-c2 & {
            opacity: 1;
          }

          .v1560qbr-1-c3 & {
            opacity: 0.7;
          }
        }
      }"
    `);
  });
});
