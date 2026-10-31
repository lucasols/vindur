import { dedent } from '@ls-stack/utils/dedent';
import { SourceMapConsumer } from 'source-map';
import { expect, test } from 'vitest';
import { transform } from '../src/transform';
import { createFsMock } from './testUtils';

function transformWithMap(source: string) {
  return transform({
    fileAbsPath: '/src/App.tsx',
    source,
    fs: createFsMock({}),
    transformFunctionCache: {},
    transformDynamicColorCache: {},
    importAliases: { '#/': '/' },
    sourcemap: true,
  });
}

/** The original `line:column` of the first occurrence of `snippet` in the output */
async function originalPositionOf(
  source: string,
  snippet: string,
): Promise<string> {
  const result = transformWithMap(source);
  if (!result.map) throw new Error('missing sourcemap');

  const index = result.code.indexOf(snippet);
  const before = result.code.slice(0, index);
  const line = before.split('\n').length;
  const column = index - before.lastIndexOf('\n') - 1;

  const consumer = await new SourceMapConsumer(result.map);
  try {
    const original = consumer.originalPositionFor({ line, column });
    return `${original.line}:${original.column}`;
  } finally {
    consumer.destroy();
  }
}

/** The `line:column` of the first occurrence of `snippet` in the source */
function sourcePositionOf(source: string, snippet: string): string {
  const index = source.indexOf(snippet);
  const before = source.slice(0, index);
  return `${before.split('\n').length}:${index - before.lastIndexOf('\n') - 1}`;
}

test('should map code after removed styles back to the source', async () => {
  const source = dedent`
    import { css, styled } from 'vindur'

    const box = css\`
      color: red;
      padding: 10px;
    \`

    const Button = styled.button\`
      background: blue;
    \`

    export function App() {
      return (
        <div className="side-nav-container">
          <Button className={box}>{'toast message'}</Button>
        </div>
      );
    }
  `;

  expect(await originalPositionOf(source, '"side-nav-container"')).toBe(
    sourcePositionOf(source, '"side-nav-container"'),
  );
  expect(await originalPositionOf(source, "'toast message'")).toBe(
    sourcePositionOf(source, "'toast message'"),
  );
});

test('should count columns in UTF-16 code units', async () => {
  const source = dedent`
    import { css } from 'vindur'

    const box = css\`
      color: red;
    \`

    export const label = '🎨 colors'; export const value = box;
  `;

  // JS string indexes are UTF-16 code units too
  expect(await originalPositionOf(source, 'export const value')).toBe(
    sourcePositionOf(source, 'export const value'),
  );
});

test('should include the source in the sourcemap', () => {
  const source = dedent`
    import { css } from 'vindur'

    export const box = css\`
      color: red;
    \`
  `;

  const result = transformWithMap(source);

  expect(result.map?.sources).toEqual(['/src/App.tsx']);
  expect(result.map?.sourcesContent).toEqual([source]);
});

test('should not emit a sourcemap without the sourcemap option', () => {
  const result = transform({
    fileAbsPath: '/src/App.tsx',
    source: `export const value = 1;`,
    fs: createFsMock({}),
    transformFunctionCache: {},
    transformDynamicColorCache: {},
    importAliases: { '#/': '/' },
  });

  expect(result.map).toBeNull();
});
