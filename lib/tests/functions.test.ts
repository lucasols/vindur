import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transform, type TransformFS } from '../src/transform';

function createFsMock(files: Record<string, string>): TransformFS {
  return {
    readFile: (filePath: string) => {
      const file = files[filePath];

      if (!file) {
        throw new Error(`File not found: ${filePath}`);
      }

      return file;
    },
  };
}

test('function with simple params', () => {
  const fnFile = dedent`
    export const pixelSize = vindurFn((size: number) => '\${size}px')
  `;

  const source = dedent`
    import { css } from 'vindur'
    import { pixelSize } from './functions'

    const style = css\`
      width: \${pixelSize(10)};
    \`
  `;

  const { code, css } = transform({
    filePath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot();
  expect(code).toMatchInlineSnapshot();
});

test('function with multiple params', () => {
  const fnFile = dedent`
    export const margin = vindurFn((top: number, right: number, bottom: number, left: number) => \`
      margin: \${top}px \${right}px \${bottom}px \${left}px;
    \`)
  `;

  const source = dedent`
    import { css } from 'vindur'
    import { margin } from './functions'

    const style = css\`
      \${margin(10, 20, 30, 40)};
    \`
  `;

  const { code, css } = transform({
    filePath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot();
  expect(code).toMatchInlineSnapshot();
});

test('function with destructured object param', () => {
  const fnFile = dedent`
    export const inline = vindurFn(({ justify = 'left', align = 'center', gap }) => \`
      display: flex;
      justify-content: \${justify === 'left' ? 'flex-start' : justify === 'right' ? 'flex-end' : 'center'};
      align-items: \${align === 'center' ? 'center' : 'flex-end'};
      gap: \${gap}px;
    \`)
  `;

  const source = dedent`
    import { css } from 'vindur'
    import { pixelSize } from './functions'

    const style = css\`
      \${inline({ gap: 10 })};
    \`
  `;

  const { code, css } = transform({
    filePath: 'test.ts',
    source,
    fs: createFsMock({ './functions.ts': fnFile }),
  });

  expect(css).toMatchInlineSnapshot();
  expect(code).toMatchInlineSnapshot();
});
