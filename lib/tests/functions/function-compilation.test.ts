import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

test('compile file with exported function', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { spacing } from '@/utils'

      // Just test that importing vindurFn functions works
      console.log('Spacing function imported successfully')
    `,
    overrideDefaultFs: createFsMock({
      'utils.ts': dedent`
        import { vindurFn } from 'vindur'
        export const spacing = vindurFn((size: number) => \`\${size}px\`)
      `,
    }),
    overrideDefaultImportAliases: {
      '@/': '/',
    },
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { spacing } from "@/utils";

    // Just test that importing vindurFn functions works
    console.log("Spacing function imported successfully");
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`""`);
});

test('compile file with vindurFn function and css exports', async () => {
  const fnFile = dedent`
    import { vindurFn, css } from 'vindur'

    export const spacing = vindurFn((size: number) => \`\${size}px\`)

    export const spacingCss = css\`
      margin: 16px;
    \`
  `;

  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { spacingCss } from '#/utils'

      const style = css\`
        \${spacingCss};
      \`
    `,
    overrideDefaultFs: createFsMock({ 'utils.ts': fnFile }),
  });

  expect(result.css).toMatchInlineSnapshot(`""`);

  expect(result.code).toMatchInlineSnapshot(`
    "const style = "v1i9guam-1-spacingCss v1560qbr-1-style";
    "
  `);
});

test('valid function to css', async () => {
  const fnFile = dedent`
    import { vindurFn } from 'vindur';

    export const transition = vindurFn(
      ({
        duration = 'medium',
        easing = 'in-out',
        delay = 0,
        property,
      }: {
        duration?: 'medium' | 'slow' | 'fast';
        easing?: 'in-out' | 'out' | 'in' | 'linear';
        delay?: number;
        property?: string;
      } = {}) =>
        \`transition: \${
          duration === 'medium' ? 0.24
          : duration === 'slow' ? 0.36
          : 0.12
        }s \${
          easing === 'in-out' ? 'cubic-bezier(0.4, 0.0, 0.2, 1)'
          : easing === 'out' ? 'cubic-bezier(0.0, 0.0, 0.2, 1)'
          : easing === 'in' ? 'cubic-bezier(0.4, 0.0, 1, 1)'
          : 'linear'
        }\${delay ? \` \${delay}ms\` : ''};
        \${property ? \`transition-property: \${property};\` : ''}
      \`,
    );
  `;

  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      import { transition } from '#/utils'

      const Container = styled.div\`
        \${transition()};
      \`

      const Component: FC = () => {
        return <Container />
      }
    `,
    overrideDefaultFs: createFsMock({ 'utils.ts': fnFile }),
  });

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-Container {
      transition: 0.24s cubic-bezier(0.4, 0, 0.2, 1);
    }
    "
  `);

  expect(result.code).toMatchInlineSnapshot(`
    "const Component: FC = () => {
      return <div className="v1560qbr-1-Container" />;
    };
    "
  `);
});
