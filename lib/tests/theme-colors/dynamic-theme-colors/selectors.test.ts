import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createDynamicCssColor } from '../../../src/main';
import { transformWithFormat } from '../../testUtils';

describe('Dynamic Colors - Conditional Selectors', () => {
  test('should transform basic dynamic color usage with dev mode selectors', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const dynamicColor = createDynamicCssColor()

      const Container = styled.div\`
        background: \${dynamicColor.value};
        color: \${dynamicColor.contrast.value};

        \${dynamicColor.self.isDark} {
          border: 2px solid white;
        }

        \${dynamicColor.self.isLight} {
          border: 2px solid black;
        }
      \`

      const Component = () => {
        return (
          <div dynamicColor={dynamicColor.set('#ff6b6b')}>
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
      const dynamicColor = createDynamicCssColor("v1560qbr-1-dynamicColor", true);
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
        background: var(--v1560qbr-1-dynamicColor);
        color: var(--v1560qbr-1-dynamicColor-c);

        &.v1560qbr-1-dynamicColor-self-isDark {
          border: 2px solid white;
        }

        &.v1560qbr-1-dynamicColor-self-isLight {
          border: 2px solid black;
        }
      }
      "
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
          <div dynamicColor={color.set('#ff6b6b')}>
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
      const color = createDynamicCssColor("v1560qbr-1-color", true);
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

        .v1560qbr-1-color-container-isLight & {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .v1560qbr-1-color-container-isDark & {
          box-shadow: 0 2px 8px rgba(255, 255, 255, 0.1);
        }

        .v1560qbr-1-color-container-isDefined & {
          border-radius: 8px;
        }

        .v1560qbr-1-color-container-isNotDefined & {
          border: 1px solid #ccc;
        }
      }
      "
    `);
  });

  test('should transform dynamic color with all conditional selectors', async () => {
    const source = dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const ComplexComponent = styled.div\`
        background: \${color.value};

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
        return <ComplexComponent dynamicColor={color.set('#ff6b6b')}>All selectors test</ComplexComponent>;
      }
    `;

    const result = await transformWithFormat({
      source,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { createDynamicCssColor } from "vindur";
      const color = createDynamicCssColor("v1560qbr-1-color", true);
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
        background: var(--v1560qbr-1-color);

        &.v1560qbr-1-color-self-isDark {
          color: white;
        }

        &.v1560qbr-1-color-self-isLight {
          color: black;
        }

        &.v1560qbr-1-color-self-isDefined {
          border: 1px solid;
        }

        &.v1560qbr-1-color-self-isNotDefined {
          border: 1px dashed #ccc;
        }

        &.v1560qbr-1-color-self-isVeryDark {
          font-weight: bold;
        }

        &.v1560qbr-1-color-self-isNotVeryDark {
          font-weight: normal;
        }

        &.v1560qbr-1-color-self-isVeryLight {
          text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.5);
        }

        &.v1560qbr-1-color-self-isNotVeryLight {
          text-shadow: none;
        }
      }
      "
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
          <div dynamicColor={color.set('#ff6b6b')}>
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
      const color = createDynamicCssColor("v1560qbr-1-color", true);
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

          .v1560qbr-1-color-container-isLight & {
            color: #333;
          }

          .v1560qbr-1-color-container-isDark & {
            color: #fff;
          }
        }

        .content {
          margin-top: 16px;

          .v1560qbr-1-color-container-isDefined & {
            opacity: 1;
          }

          .v1560qbr-1-color-container-isNotDefined & {
            opacity: 0.7;
          }
        }
      }
      "
    `);
  });

  test('should throw when a container selector alone selects a rule', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { createDynamicCssColor, styled } from 'vindur'

          const color = createDynamicCssColor()

          const Card = styled.div\`
            \${color.container.isDark} {
              color: white;
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: \`\${color.container.isDark}\` matches an ancestor that sets the color. Use \`\${color.container.isDark} & { ... }\` to style this element, or \`& \${color.container.isDark} { ... }\` to style descendants that set the color
      loc: 6:4]
    `);
  });

  test('should allow container selectors combined with & or in global styles', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { createDynamicCssColor, createGlobalStyle, styled } from 'vindur'

        const color = createDynamicCssColor()

        createGlobalStyle\`
          \${color.container.isDark} {
            color: white;
          }
        \`

        const Title = styled.h1\`
          font-size: 12px;
        \`

        const Card = styled.div\`
          \${color.container.isDark} & {
            color: white;
          }

          & \${color.container.isLight} {
            color: black;
          }

          & \${Title} \${color.container.isDefined} {
            color: blue;
          }
        \`

        export const App = () => <Card><Title /></Card>
      `,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-color-container-isDark {
        color: white;
      }

      .v1560qbr-3-Title {
        font-size: 12px;
      }

      .v1560qbr-4-Card {
        .v1560qbr-1-color-container-isDark & {
          color: white;
        }

        & .v1560qbr-1-color-container-isLight {
          color: black;
        }

        & .v1560qbr-3-Title .v1560qbr-1-color-container-isDefined {
          color: blue;
        }
      }
      "
    `);
  });

  test('should not warn about self selectors as undeclared classes', async () => {
    const warnings: string[] = [];
    await transformWithFormat({
      source: dedent`
        import { createDynamicCssColor, styled } from 'vindur'

        const color = createDynamicCssColor()

        const Box = styled.div\`
          \${color.self.isDark} {
            color: red;
          }
        \`

        export const App = ({ c }) => <Box dynamicColor={color.set(c)} />
      `,
      onWarning: (warning) => warnings.push(warning.message),
    });

    expect(warnings).toMatchInlineSnapshot(`[]`);
  });
});

const conditions = [
  'isDark',
  'isLight',
  'isDefined',
  'isNotDefined',
  'isVeryDark',
  'isNotVeryDark',
  'isVeryLight',
  'isNotVeryLight',
] as const;

const dynamicColorIdRegex = /createDynamicCssColor\("([^"]+)"/;
const nestedSelectorRegex = /^ +(.+) \{$/gm;

async function getCompiledSelectors(production: boolean) {
  const rules = conditions.flatMap((condition) => [
    `\${bg.self.${condition}} { --self-${condition}: 1; }`,
    `\${bg.container.${condition}} & { --container-${condition}: 1; }`,
  ]);
  const result = await transformWithFormat({
    source: [
      `import { createDynamicCssColor, css } from 'vindur'`,
      `const bg = createDynamicCssColor()`,
      `export const styles = css\`${rules.join('\n')}\``,
    ].join('\n'),
    production,
  });

  const id = dynamicColorIdRegex.exec(result.code)?.[1];
  if (!id) throw new Error('Dynamic color id not found');

  return {
    id,
    selectors: [...result.css.matchAll(nestedSelectorRegex)].map(
      (match) => match[1],
    ),
  };
}

describe('Dynamic Colors - compiled selectors match the runtime classes', () => {
  test('in dev mode', async () => {
    const { id, selectors } = await getCompiledSelectors(false);
    const color = createDynamicCssColor(id, true);

    expect(id).toBe('v1560qbr-1-bg');
    expect(selectors).toEqual(
      conditions.flatMap((condition) => [
        color.self[condition],
        `${color.container[condition]} &`,
      ]),
    );
    expect(selectors.slice(0, 2)).toMatchInlineSnapshot(`
      [
        "&.v1560qbr-1-bg-self-isDark",
        ".v1560qbr-1-bg-container-isDark &",
      ]
    `);
  });

  test('in production', async () => {
    const { id, selectors } = await getCompiledSelectors(true);
    const color = createDynamicCssColor(id, false);

    expect(id).toBe('v1560qbr-1');
    expect(selectors).toEqual(
      conditions.flatMap((condition) => [
        color.self[condition],
        `${color.container[condition]} &`,
      ]),
    );
    expect(selectors.slice(0, 2)).toMatchInlineSnapshot(`
      [
        "&.v1560qbr-1-s0",
        ".v1560qbr-1-c0 &",
      ]
    `);
  });
});
