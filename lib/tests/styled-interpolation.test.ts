import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from './testUtils';

const importAliases = { '#/': '/' };
const emptyFs = createFsMock({});

describe('styled components - interpolation', () => {
  test('should resolve simple variables at compile time', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const primaryColor = 'blue'
      const fontSize = 16

      const StyledText = styled.p\`
        color: \${primaryColor};
        font-size: \${fontSize}px;
      \`

      const App = () => <StyledText>Hello</StyledText>
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        color: blue;
        font-size: 16px;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const primaryColor = "blue";
      const fontSize = 16;
      const App = () => <p className="v1560qbr-1">Hello</p>;
      "
    `);
  });

  test('should handle nested template literals', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const prefix = 'my'
      const suffix = 'value'

      const StyledDiv = styled.div\`
        content: "\${prefix}-\${suffix}";
      \`

      const App = () => <StyledDiv />
    `;

    const result = await transformWithFormat({
      source,
      overrideDefaultFs: emptyFs,
      overrideDefaultImportAliases: importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".v1560qbr-1 {
        content: "my-value";
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const prefix = "my";
      const suffix = "value";
      const App = () => <div className="v1560qbr-1" />;
      "
    `);
  });
});
