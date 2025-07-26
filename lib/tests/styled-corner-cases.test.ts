import { dedent } from '@ls-stack/utils/dedent';
import { describe, expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from './testUtils';

const importAliases = { '#/': '/' };
const emptyFs = createFsMock({});

describe('styled components - corner cases', () => {
  test('should handle empty styled templates', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const EmptyStyled = styled.div\`\`

      const App = () => <EmptyStyled />
    `;

    const result = await transformWithFormat({
      source,
      fileAbsPath: '/src/empty.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`""`);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <div className="v1v2q6wl-1" />;
      "
    `);
  });

  test('should handle styled components with special characters', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const StyledDiv = styled.div\`
        content: "quotes \\"with\\" escapes";
        background: url('image.png');
        font-family: 'Font Name', sans-serif;
      \`

      const App = () => <StyledDiv>Content</StyledDiv>
    `;

    const result = await transformWithFormat({
      source,
      fileAbsPath: '/src/special.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".viwoa2i-1 {
        content: "quotes \\"with\\" escapes";
        background: url('image.png');
        font-family: 'Font Name', sans-serif;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => <div className="viwoa2i-1">Content</div>;
      "
    `);
  });

  test('should merge className when styled component already has className', async () => {
    const source = dedent`
      import { styled } from 'vindur'

      const StyledButton = styled.button\`
        background: blue;
        color: white;
      \`

      const App = () => (
        <div>
          <StyledButton className="extra-class">Click me</StyledButton>
          <StyledButton className={\`dynamic-\${true ? 'active' : 'inactive'}\`}>Dynamic</StyledButton>
        </div>
      )
    `;

    const result = await transformWithFormat({
      source,
      fileAbsPath: '/src/merge-class.ts',
      fs: emptyFs,
      importAliases,
    });

    expect(result.css).toMatchInlineSnapshot(`
      ".vylwivr-1 {
        background: blue;
        color: white;
      }"
    `);

    expect(result.code).toMatchInlineSnapshot(`
      "const App = () => (
        <div>
          <button className="vylwivr-1 extra-class">Click me</button>
          <button
            className={\`vylwivr-1 \${\`dynamic-\${true ? "active" : "inactive"}\`}\`}
          >
            Dynamic
          </button>
        </div>
      );
      "
    `);
  });
});
