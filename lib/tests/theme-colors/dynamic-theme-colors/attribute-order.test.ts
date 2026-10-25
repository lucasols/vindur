import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../../testUtils';

test('should place the dynamic color props after a later spread and props with JSX', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Title = styled.h1\`
        font-size: 12px;
      \`

      const Card = styled.div\`
        color: \${color.var};
      \`

      const Component = (props) => (
        <Card
          dynamicColor={color.set('#ff6b6b')}
          {...props}
          header={<Title>hi</Title>}
        />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor, mergeClassNames, mergeStyles } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    const Component = (props) => (
      <div
        {...props}
        header={<h1 className="v1560qbr-2-Title">hi</h1>}
        {...color._sp("#ff6b6b", {
          className: mergeClassNames([props], "v1560qbr-3-Card"),
          style: mergeStyles([props]),
        })}
      />
    );
    "
  `);
});

test('should apply style flags of a styled component with dynamicColor', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor, styled } from 'vindur'

      const color = createDynamicCssColor()

      const Flag = styled.div<{ active: boolean; size: 'small' | 'large' }>\`
        color: \${color.var};

        &.active {
          color: blue;
        }

        &.size-small {
          padding: 4px;
        }
      \`

      const Component = ({ active, c }) => (
        <Flag active={active} size="small" dynamicColor={color.set(c)} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    const Component = ({ active, c }) => (
      <div
        {...color._sp(c, {
          className: [
            "v1560qbr-2-Flag vr4ikfs-size-small",
            active && "voctcyj-active",
          ]
            .filter(Boolean)
            .join(" "),
        })}
      />
    );
    "
  `);
});

test('should escape quotes of a className string merged into the dynamic color props', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { createDynamicCssColor } from 'vindur'

      const color = createDynamicCssColor()

      const Component = ({ c }) => (
        <div className='before:content-["hello"]' dynamicColor={color.set(c)} />
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { createDynamicCssColor } from "vindur";
    const color = createDynamicCssColor("v1560qbr-1-color", true);
    const Component = ({ c }) => (
      <div
        {...color._sp(c, {
          className: 'before:content-["hello"]',
        })}
      />
    );
    "
  `);
});
