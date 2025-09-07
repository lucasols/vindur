import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

test('should extend CSS styles imported from another file', async () => {
  const stylesFile = dedent`
    import { css } from 'vindur'

    export const baseStyles = css\`
      display: flex;
      align-items: center;
      background: white;
    \`
  `;

  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { baseStyles } from '#/styles'

      const styles = css\`
        \${baseStyles};
        padding: 12px 24px;
        border-radius: 4px;
        font-weight: 500;
      \`

      const App = () => <div className={styles}>Hello</div>
    `,

    overrideDefaultFs: createFsMock({
      'styles.ts': stylesFile,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const styles = "v1560qbr-1-styles";
    const App = () => <div className={styles}>Hello</div>;
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-styles {
      display: flex;
      align-items: center;
      background: white;
      padding: 12px 24px;
      border-radius: 4px;
      font-weight: 500;
    }
    "
  `);

  const stylesTransformResult = await transformWithFormat({
    source: stylesFile,
    sourcePath: '/styles.ts',
  });

  expect(stylesTransformResult.css).toMatchInlineSnapshot(`
    ".v1s4vg6s-1-baseStyles {
      display: flex;
      align-items: center;
      background: white;
    }
    "
  `);
});

test('should extend CSS styles in styled components from imports', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      import { buttonBase } from '#/styles'

      const Button = styled.button\`
        \${buttonBase};
        background: #007bff;
        color: white;
      \`

      const App = () => <Button>Click me</Button>
    `,

    overrideDefaultFs: createFsMock({
      'styles.ts': dedent`
        import { css } from 'vindur'

        export const buttonBase = css\`
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        \`
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const App = () => <button className="v1560qbr-1-Button">Click me</button>;
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      background: #007bff;
      color: white;
    }
    "
  `);
});

test('should handle multiple imported CSS extensions', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      import { baseLayout, buttonStyles } from '#/styles'

      const Card = styled.div\`
        \${baseLayout};
        background: white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      \`

      const Button = styled.button\`
        \${buttonStyles};
        background: #28a745;
        color: white;
      \`

      const App = () => (
        <Card>
          <Button>Submit</Button>
        </Card>
      )
    `,

    overrideDefaultFs: createFsMock({
      'styles.ts': dedent`
        import { css } from 'vindur'

        export const baseLayout = css\`
          padding: 20px;
          border-radius: 8px;
          margin: 16px;
        \`

        export const buttonStyles = css\`
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          font-weight: bold;
          cursor: pointer;
        \`
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const App = () => (
      <div className="v1560qbr-1-Card">
        <button className="v1560qbr-2-Button">Submit</button>
      </div>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Card {
      padding: 20px;
      border-radius: 8px;
      margin: 16px;
      background: white;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .v1560qbr-2-Button {
      padding: 10px 20px;
      border: none;
      border-radius: 4px;
      font-weight: bold;
      cursor: pointer;
      background: #28a745;
      color: white;
    }
    "
  `);
});

test('should handle mixed local and imported CSS extensions', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, styled } from 'vindur'
      import { baseLayout } from '#/styles'

      const localStyles = css\`
        border: 2px solid #ddd;
        transition: all 0.3s ease;
      \`

      const Card = styled.div\`
        \${baseLayout};
        \${localStyles};
        background: white;
      \`

      const App = () => <Card>Content</Card>
    `,

    overrideDefaultFs: createFsMock({
      'styles.ts': dedent`
        import { css } from 'vindur'

        export const baseLayout = css\`
          padding: 16px;
          border-radius: 8px;
          margin: 8px;
        \`
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const localStyles = "v1560qbr-1-localStyles";
    const App = () => <div className="v1560qbr-2-Card">Content</div>;
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-localStyles {
      border: 2px solid #ddd;
      transition: all 0.3s ease;
    }

    .v1560qbr-2-Card {
      padding: 16px;
      border-radius: 8px;
      margin: 8px;

      border: 2px solid #ddd;
      transition: all 0.3s ease;
      background: white;
    }
    "
  `);
});

test('should throw error when imported CSS is not found', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { unknownStyles } from '#/styles'

        const Card = styled.div\`
          \${unknownStyles};
          background: white;
        \`
      `,
      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          import { css } from 'vindur'

          export const baseStyles = css\`
            padding: 16px;
          \`
        `,
      }),
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(
    `
      [TransformError: /test.tsx: Function "unknownStyles" not found in /styles.ts
      loc: {
        "column": 6,
        "filename": "/styles.ts",
        "line": 4,
      }]
    `,
  );
});

test('should handle CSS extension with variable interpolation in external file', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      import { responsiveLayout } from '#/styles'

      const Container = styled.div\`
        \${responsiveLayout};
        background: #f8f9fa;
      \`

      const App = () => <Container>Content</Container>
    `,
    overrideDefaultFs: createFsMock({
      'styles.ts': dedent`
        import { css } from 'vindur'

        const maxWidth = '1200px'
        const padding = '20px'

        export const responsiveLayout = css\`
          max-width: \${maxWidth};
          padding: \${padding};
          margin: 0 auto;
        \`
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const App = () => <div className="v1560qbr-1-Container">Content</div>;
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Container {
      max-width: 1200px;
      padding: 20px;
      margin: 0 auto;
      background: #f8f9fa;
    }
    "
  `);
});

test('should throw error on direct circular import', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { baseStyles } from '#/styles'

        export const mainStyles = css\`
          \${baseStyles};
          color: blue;
        \`
      `,
      overrideDefaultFs: createFsMock({
        'styles.ts': dedent`
          import { css } from 'vindur'
          import { mainStyles } from '#/test'

          export const baseStyles = css\`
            \${mainStyles};
            padding: 16px;
          \`
        `,
      }),
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(
    `
    [TransformError: /test.tsx: /styles.ts: Invalid interpolation used at \`... baseStyles = css\` ... \${mainStyles}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
    loc: {
      "column": 4,
      "filename": undefined,
      "line": 5,
    }
    ignoreInLint: true]
  `,
  );
});

test('should throw error on indirect circular import', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { css } from 'vindur'
        import { styleA } from '#/fileA'

        export const mainStyles = css\`
          \${styleA};
          color: red;
        \`
      `,
      overrideDefaultFs: createFsMock({
        'fileA.ts': dedent`
          import { css } from 'vindur'
          import { styleB } from '#/fileB'

          export const styleA = css\`
            \${styleB};
            margin: 8px;
          \`
        `,
        'fileB.ts': dedent`
          import { css } from 'vindur'
          import { mainStyles } from '#/test'

          export const styleB = css\`
            \${mainStyles};
            padding: 12px;
          \`
        `,
      }),
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(
    `
    [TransformError: /test.tsx: /fileA.ts: Invalid interpolation used at \`... styleA = css\` ... \${styleB}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported
    loc: {
      "column": 4,
      "filename": undefined,
      "line": 5,
    }
    ignoreInLint: true]
  `,
  );
});

test('should allow importing css and functions from another file', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, styled } from 'vindur'
      import { baseStyles, getSpacing } from '#/utils'

      const Card = styled.div\`
        \${baseStyles};
        margin: \${getSpacing()};
      \`

      const App = () => <Card>Content</Card>
    `,

    overrideDefaultFs: createFsMock({
      'utils.ts': dedent`
        import { css, vindurFn } from 'vindur'

        export const baseStyles = css\`
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          background: white;
        \`

        export const getSpacing = vindurFn(({ multiplier }: { multiplier?: number } = {}) => \`\${multiplier ? '2' : '1'}px\`)
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const App = () => <div className="v1560qbr-1-Card">Content</div>;
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Card {
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      background: white;
      margin: 1px;
    }
    "
  `);
});

test('should allow importing css and functions from another file with arguments', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css, styled } from 'vindur'
      import { baseStyles, getSpacing } from '#/utils'

      const Card = styled.div\`
        \${baseStyles};
        margin: \${getSpacing({ multiplier: 2 })};
      \`

      const App = () => <Card>Content</Card>
    `,

    overrideDefaultFs: createFsMock({
      'utils.ts': dedent`
        import { css, vindurFn } from 'vindur'

        export const baseStyles = css\`
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          background: white;
        \`

        export const getSpacing = vindurFn(({ multiplier }: { multiplier?: number } = {}) => \`\${multiplier ? '2' : '1'}px\`)
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const App = () => <div className="v1560qbr-1-Card">Content</div>;
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Card {
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      background: white;
      margin: 2px;
    }
    "
  `);
});
