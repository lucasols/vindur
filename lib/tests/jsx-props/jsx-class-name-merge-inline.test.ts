import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transform } from '../../src/transform';
import { createFsMock, transformWithFormat } from '../testUtils';

test('should inline the class name of an imported css prop reference', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { card } from './styles';

      export const A = () => <div css={card} />;
    `,
    overrideDefaultFs: createFsMock({
      'styles.ts': dedent`
        import { css } from 'vindur';

        export const card = css\`
          color: red;
        \`;
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import "./styles";
    export const A = () => <div className="v1s4vg6s-1-card" />;
    "
  `);
});

test('should not guard string and template literal className values', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const A = ({ on, size }: { on: boolean; size: string }) => (
        <>
          <div className={'base'} cx={{ $on: on }} />
          <div className={\`size-\${size}\`} css={\`color: red;\`} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    export const A = ({ on, size }: { on: boolean; size: string }) => (
      <>
        <div
          className={
            "base" +
            " " +
            cx({
              on: on,
            })
          }
        />
        <div className={\`size-\${size}\` + " v1560qbr-1-css-prop-1"} />
      </>
    );
    "
  `);
});

test('should rewrite cx modifiers after a quote inside a comment', () => {
  const result = transform({
    fileAbsPath: '/test.tsx',
    fs: createFsMock({}),
    transformFunctionCache: {},
    transformDynamicColorCache: {},
    importAliases: { '#/': '/' },
    source: dedent`
      import { styled } from 'vindur';

      const Box = styled.div\`
        /* don't remove */
        &.active {
          color: red;
        }
      \`;

      export const A = ({ on }: { on: boolean }) => <Box cx={{ active: on }} />;
    `,
    dev: true,
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Box {
      /* don't remove */
      &.v1560qbr-2-active {
        color: red;
      }
    }"
  `);
});
