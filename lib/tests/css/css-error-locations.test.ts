import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should throw for a missing `;` before a nested rule', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          color: red
          &:hover {
            color: blue;
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: missing \`;\` before a nested rule, \`color: red &:hover\` is not a valid selector
    loc: 4:2]
  `);
});

test('should throw for a missing `;` after a custom property', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          ---size: 10px
          width: var(---size);
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: missing \`;\` before \`width\`
    loc: 5:2]
  `);
});

test('should explain that `//` comments are not supported', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const style = css\`
          color: red; // primary color
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: \`//\` comments are not supported in CSS, use \`/* ... */\`
    loc: 4:14]
  `);
});

test('should point to the interpolation when its value has invalid CSS', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const base = css\`
          color: red;
        \`

        const style = css\`
          width: 1px
          \${base};
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: missing \`;\` before \`color\` (found in the interpolated value)
    loc: 9:4]
  `);
});

test('should throw for declarations in a global media rule', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        createGlobalStyle\`
          @media print {
            color: red;
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`createGlobalStyle\`: declarations in createGlobalStyle need a rule, e.g. \`body { ... }\`
    loc: 5:4]
  `);
});

test('should locate invalid CSS in a named createGlobalStyle rule', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { createGlobalStyle } from 'vindur'

        const GlobalStyle = createGlobalStyle\`
          body {
            color: red
            width: 1px;
          }
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... GlobalStyle = createGlobalStyle\`: missing \`;\` before \`width\`
    loc: 6:4]
  `);
});

test('should locate invalid CSS in a css prop', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        const App = () => (
          <div
            css={\`
              color: red
              width: 1px;
            \`}
          />
        )
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`css\`: missing \`;\` before \`width\`
    loc: 5:6]
  `);
});

test('should locate a missing extension `;` in a css prop', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const base = css\`
          color: red;
        \`

        const App = () => (
          <div
            css={\`
              \${base}
              width: 1px;
            \`}
          />
        )
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Missing \`;\` after \`\${base}\`. CSS interpolations are treated as selectors unless they are followed by \`;\`, so use \`\${base};\` when extending styles.
    loc: 10:8]
  `);
});

test('should locate invalid CSS in a css tag that is not assigned', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        export default css\`
          color: red
          width: 1px;
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`css\`: missing \`;\` before \`width\`
    loc: 5:2]
  `);
});

test('should locate invalid CSS in a default exported styled component', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        export default styled.div\`
          color: red
          width: 1px;
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`styled\`: missing \`;\` before \`width\`
    loc: 5:2]
  `);
});

test('should locate invalid CSS from an interpolated static value', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { css } from 'vindur'

        const value = 'red width: 1px'

        const style = css\`
          color: \${value};
        \`
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid CSS at \`... style = css\`: missing \`;\` before \`width\` (found in the interpolated value)
    loc: 6:11]
  `);
});
