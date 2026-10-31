import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { transform } from '../../src/transform';
import { createFsMock, transformWithFormat } from '../testUtils';

describe('Exported styled components', () => {
  test('should transform exported styled component to _vSC function', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        export const Button = styled.button\`
          background: blue;
          color: white;
          padding: 12px 24px;
          border-radius: 4px;
          border: none;
          cursor: pointer;
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      export const Button = _vSC("button", "v1560qbr-1-Button");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: blue;
        color: white;
        padding: 12px 24px;
        border-radius: 4px;
        border: none;
        cursor: pointer;
      }
      "
    `);
  });

  test('should handle multiple exported styled components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        export const Button = styled.button\`
          background: blue;
          color: white;
          padding: 8px 16px;
        \`

        export const Card = styled.div\`
          background: white;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        \`

        export const Title = styled.h1\`
          font-size: 24px;
          color: #333;
          margin-bottom: 16px;
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      export const Button = _vSC("button", "v1560qbr-1-Button");
      export const Card = _vSC("div", "v1560qbr-2-Card");
      export const Title = _vSC("h1", "v1560qbr-3-Title");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: blue;
        color: white;
        padding: 8px 16px;
      }

      .v1560qbr-2-Card {
        background: white;
        border-radius: 8px;
        padding: 20px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .v1560qbr-3-Title {
        font-size: 24px;
        color: #333;
        margin-bottom: 16px;
      }
      "
    `);
  });

  test('should handle exported styled component with style extension', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const BaseButton = styled.button\`
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        \`

        export const PrimaryButton = styled(BaseButton)\`
          background: #007bff;
          color: white;
  
          &:hover {
            background: #0056b3;
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      export const PrimaryButton = _vSC(
        "button",
        "v1560qbr-1-BaseButton v1560qbr-2-PrimaryButton",
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-BaseButton {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }

      .v1560qbr-2-PrimaryButton {
        background: #007bff;
        color: white;

        &:hover {
          background: #0056b3;
        }
      }
      "
    `);
  });

  test('should pass custom components by reference to _vSC', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { Link } from 'react-router'

        export const NavLink = styled(Link)\`
          color: blue;
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      import { Link } from "react-router";
      export const NavLink = _vSC(Link, "v1560qbr-1-NavLink");
      "
    `);
  });

  test('should handle named exports', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Button = styled.button\`
          background: blue;
          color: white;
          padding: 12px 24px;
        \`

        const Card = styled.div\`
          background: white;
          padding: 20px;
        \`

        export { Button, Card }
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      const Button = _vSC("button", "v1560qbr-1-Button");
      const Card = _vSC("div", "v1560qbr-2-Card");
      export { Button, Card };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: blue;
        color: white;
        padding: 12px 24px;
      }

      .v1560qbr-2-Card {
        background: white;
        padding: 20px;
      }
      "
    `);
  });

  test('should handle renamed exports', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const InternalButton = styled.button\`
          background: green;
          color: white;
          padding: 10px 20px;
        \`

        export { InternalButton as Button }
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      const InternalButton = _vSC("button", "v1560qbr-1-InternalButton");
      export { InternalButton as Button };
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-InternalButton {
        background: green;
        color: white;
        padding: 10px 20px;
      }
      "
    `);
  });

  test('should handle default export', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Button = styled.button\`
          background: red;
          color: white;
          padding: 12px 24px;
        \`

        export default Button
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      const Button = _vSC("button", "v1560qbr-1-Button");
      export default Button;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: red;
        color: white;
        padding: 12px 24px;
      }
      "
    `);
  });

  test('should keep components default exported through a wrapped expression', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Button = styled.button\`
          background: red;
        \`

        export default (Button satisfies object)
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      const Button = _vSC("button", "v1560qbr-1-Button");
      export default Button satisfies object;
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: red;
      }
      "
    `);
  });

  test('should handle direct default export', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        export default styled.div\`
          background: white;
          padding: 20px;
          border: 1px solid #ddd;
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      export default _vSC("div", "v1560qbr-1");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        background: white;
        padding: 20px;
        border: 1px solid #ddd;
      }
      "
    `);
  });

  test('should error on default exports of other styled forms', async () => {
    await expect(
      transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          const Base = () => null

          export default styled(Base)\`
            color: red;
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: default exported styled components only support "export default styled.tag\`...\`", declare it as a variable, e.g. "const Component = styled...", and export it with "export default Component"
      loc: 5:15]
    `);

    await expect(
      transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          export default styled.input.attrs({ type: 'text' })\`
            color: red;
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: default exported styled components only support "export default styled.tag\`...\`", declare it as a variable, e.g. "const Component = styled...", and export it with "export default Component"
      loc: 3:15]
    `);

    await expect(
      transformWithFormat({
        source: dedent`
          import { styled } from 'vindur'

          export default styled.div<{ active: boolean }>\`
            &.active {
              color: red;
            }
          \`
        `,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`
      [TransformError: /test.tsx: default exported styled components only support "export default styled.tag\`...\`", declare it as a variable, e.g. "const Component = styled...", and export it with "export default Component"
      loc: 3:15]
    `);
  });

  test('should handle mixed local and exported styled components', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        // Local component - should be removed
        const LocalCard = styled.div\`
          background: #f5f5f5;
          padding: 16px;
        \`

        // Exported component - should be transformed
        export const PublicButton = styled.button\`
          background: blue;
          color: white;
          padding: 8px 16px;
        \`

        // Using both in a component
        export const App = () => (
          <LocalCard>
            <PublicButton>Click me</PublicButton>
          </LocalCard>
        )
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";

      // Local component - should be removed

      // Exported component - should be transformed
      export const PublicButton = _vSC("button", "v1560qbr-2-PublicButton");

      // Using both in a component
      export const App = () => (
        <div className="v1560qbr-1-LocalCard">
          <PublicButton>Click me</PublicButton>
        </div>
      );
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-LocalCard {
        background: #f5f5f5;
        padding: 16px;
      }

      .v1560qbr-2-PublicButton {
        background: blue;
        color: white;
        padding: 8px 16px;
      }
      "
    `);
  });

  test('should handle exported styled components with interpolations', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const primaryColor = '#007bff'
        const spacing = 16

        export const Button = styled.button\`
          background: \${primaryColor};
          color: white;
          padding: \${spacing / 2}px \${spacing}px;
          margin: \${spacing / 4}px;
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      const primaryColor = "#007bff";
      const spacing = 16;
      export const Button = _vSC("button", "v1560qbr-1-Button");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: #007bff;
        color: white;
        padding: 8px 16px;
        margin: 4px;
      }
      "
    `);
  });

  test('should handle exported styled components with component references', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        export const Button = styled.button\`
          background: #007bff;
          color: white;
          padding: 8px 16px;
        \`

        export const Container = styled.div\`
          padding: 20px;
  
          & \${Button}:hover {
            background: #0056b3;
          }
        \`
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      export const Button = _vSC("button", "v1560qbr-1-Button");
      export const Container = _vSC("div", "v1560qbr-2-Container");
      "
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1-Button {
        background: #007bff;
        color: white;
        padding: 8px 16px;
      }

      .v1560qbr-2-Container {
        padding: 20px;

        & .v1560qbr-1-Button:hover {
          background: #0056b3;
        }
      }
      "
    `);
  });

  test('should handle exported styled components with vindur functions', () => {
    const mockFS = createFsMock({
      'main.ts': `
        import { styled } from 'vindur'
        import { getSpacing } from '@utils/spacing'

        export const Button = styled.button\`
          background: #007bff;
          color: white;
          padding: \${getSpacing(2)} \${getSpacing(3)};
          margin: \${getSpacing(1)};
        \`
      `,
      src: {
        utils: {
          'spacing.ts': `
            import { vindurFn } from 'vindur'

            export const getSpacing = vindurFn((multiplier: number) => 
              \`\${multiplier * 8}px\`
            );
          `,
        },
      },
    });

    const result = transform({
      fileAbsPath: '/main.ts',
      source: mockFS.readFile('/main.ts'),
      fs: mockFS,
      transformFunctionCache: {},
      transformDynamicColorCache: {},
      importAliases: { '@utils': '/src/utils' },
      dev: true,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from 'vindur';
      export const Button = _vSC("button", "v1mq0rjp-1-Button");"
    `);

    expect(result.css).toMatchInlineSnapshot(`
      ".v1mq0rjp-1-Button {
        background: #007bff;
                color: white;
                padding: 16px 24px;
                margin: 8px;
      }"
    `);
  });

  test('should import the styled helper when it is only imported as a type', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import type { _vSC as StyledFactory } from 'vindur';

        export type Factory = typeof StyledFactory;

        export default styled.div\`
          color: red;
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      import type { _vSC as StyledFactory } from "vindur";
      export type Factory = typeof StyledFactory;
      export default _vSC("div", "v1560qbr-1");
      "
    `);
  });

  test('should pass the wrapped component of exported custom component styles', async () => {
    const result = await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import { Pie } from 'recharts';

        export const StyledPie = styled(Pie)\`
          opacity: 0.5;
        \`;
      `,
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import { _vSC } from "vindur";
      import { Pie } from "recharts";
      export const StyledPie = _vSC(Pie, "v1560qbr-1-StyledPie");
      "
    `);
  });
});
