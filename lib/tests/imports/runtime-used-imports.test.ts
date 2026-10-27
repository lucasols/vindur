import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

const constantsFs = createFsMock({
  'constants.ts': dedent`
    import { css } from 'vindur';

    export const shared = css\`
      padding: 1px;
    \`;
    export const LABEL = 'label';
    export const SIZE = 12;
  `,
});

test('should keep an imported css constant used as a className value', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { shared } from '#/constants';

      export const A = ({ on }: { on: boolean }) => (
        <div className={shared} cx={{ $active: on }} />
      );
    `,
    overrideDefaultFs: constantsFs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { cx } from "vindur";
    import { shared } from "#/constants";
    export const A = ({ on }: { on: boolean }) => (
      <div
        className={
          shared +
          " " +
          cx({
            active: on,
          })
        }
      />
    );
    "
  `);
});

test('should keep imported constants used at runtime', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { LABEL, SIZE } from '#/constants';

      const styles = css\`
        width: \${SIZE}px;
      \`;

      console.log(LABEL, SIZE, styles);
    `,
    overrideDefaultFs: constantsFs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { LABEL, SIZE } from "#/constants";
    const styles = "v1560qbr-1-styles";
    console.log(LABEL, SIZE, styles);
    "
  `);
});

test('should remove imported constants only used in templates', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import { shared, SIZE } from '#/constants';

      export const styles = css\`
        \${shared};
        width: \${SIZE}px;
      \`;
    `,
    overrideDefaultFs: constantsFs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const styles = "v1560qbr-1-styles";
    "
  `);
});

test('should keep default and type imports when removing compile-time specifiers', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur';
      import Widget, { SIZE } from '#/constants';
      import type { Props, LABEL } from '#/constants';
      import { type Item, shared } from '#/constants';

      const styles = css\`
        \${shared};
        width: \${SIZE}px;
      \`;

      export const A = (props: Props & Item) => <Widget className={styles} {...props} />;
    `,
    overrideDefaultFs: constantsFs,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import Widget from "#/constants";
    import type { Props, LABEL } from "#/constants";
    import { type Item } from "#/constants";
    const styles = "v1560qbr-1-styles";
    export const A = (props: Props & Item) => (
      <Widget className={styles} {...props} />
    );
    "
  `);
});
