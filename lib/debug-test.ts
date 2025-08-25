import { dedent } from '@ls-stack/utils/dedent';
import { createFsMock, transformWithFormat } from './tests/testUtils';

async function debugTest() {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { themeColor } from '#/colors'

      const styles = css\`
        color: \${themeColor.var};
      \`

      const App = () => <div className={styles} dynamicColor={themeColor.set('#ff0000')} />
    `,
    overrideDefaultFs: createFsMock({
      'colors.ts': dedent`
        import { createDynamicCssColor } from 'vindur'
        export const themeColor = createDynamicCssColor()
      `,
    }),
  });

  console.log('=== CODE ===');
  console.log(result.code);
  console.log('=== CSS ===');
  console.log(result.css);
}

debugTest().catch(console.error);
