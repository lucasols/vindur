import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should keep local styled components referenced as values as runtime components', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { ButtonElement, MoreMenu } from '#/components';

      const Container = styled.label\`
        color: red;
      \`;

      const DivContainer = Container.withComponent('div');

      const IconButton = styled(ButtonElement)\`
        color: blue;
      \`;

      export const A = ({ asDiv }: { asDiv: boolean }) => {
        const El = asDiv ? DivContainer : Container;
        return (
          <El>
            <IconButton />
            <MoreMenu buttonContainer={IconButton} />
          </El>
        );
      };
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vSC } from "vindur";
    import { ButtonElement, MoreMenu } from "#/components";
    const Container = _vSC("label", "v1560qbr-1-Container");
    const DivContainer = _vSC("div", "v1560qbr-1-Container");
    const IconButton = _vSC(ButtonElement, "v1560qbr-2-IconButton");
    export const A = ({ asDiv }: { asDiv: boolean }) => {
      const El = asDiv ? DivContainer : Container;
      return (
        <El>
          <IconButton />
          <MoreMenu buttonContainer={IconButton} />
        </El>
      );
    };
    "
  `);
});

test('should keep a local styled component with style flags referenced as a value', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { MoreMenu } from '#/components';

      const IconButton = styled.button<{ active: boolean }>\`
        &.active {
          color: red;
        }
      \`;

      export const A = () => <MoreMenu buttonContainer={IconButton} />;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vCWM } from "vindur";
    import { MoreMenu } from "#/components";
    const IconButton = _vCWM(
      [["active", "voctcyj-active"]],
      "v1560qbr-1-IconButton",
      "button",
    );
    export const A = () => <MoreMenu buttonContainer={IconButton} />;
    "
  `);
});

test('should not keep styled components only referenced in JSX, templates and type queries', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Icon = styled.span\`
        color: red;
      \`;

      const Button = styled.button\`
        \${Icon} {
          color: blue;
        }
      \`;

      const LinkButton = styled(Button)\`
        text-decoration: none;
      \`;

      type IconType = typeof Icon;

      export const A = () => (
        <div css={\`& \${Icon} { margin: 0; }\`}>
          <LinkButton>
            <Icon />
          </LinkButton>
        </div>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "type IconType = typeof Icon;
    export const A = () => (
      <div className="v1560qbr-4-css-prop-4">
        <button className="v1560qbr-2-Button v1560qbr-3-LinkButton">
          <span className="v1560qbr-1-Icon" />
        </button>
      </div>
    );
    "
  `);
});

test('should reference the component of an exported styled component extension', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { ButtonElement } from '#/components';

      export const IconButton = styled(ButtonElement)\`
        color: blue;
      \`;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vSC } from "vindur";
    import { ButtonElement } from "#/components";
    export const IconButton = _vSC(ButtonElement, "v1560qbr-1-IconButton");
    "
  `);
});

test('should keep local styled components referenced in attrs', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { Menu } from '#/components';

      const Trigger = styled.button\`
        color: red;
      \`;

      export const StyledMenu = styled(Menu).attrs({ trigger: Trigger })\`
        color: blue;
      \`;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vSC } from "vindur";
    import { Menu } from "#/components";
    const Trigger = _vSC("button", "v1560qbr-1-Trigger");
    export const StyledMenu = _vSC(Menu, "v1560qbr-2-StyledMenu", {
      trigger: Trigger,
    });
    "
  `);
});

test('should keep local styled components passed as a non-template css value of a custom component', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { Chart } from '#/components';

      const Tooltip = styled.div\`
        color: red;
      \`;

      export const A = () => <Chart css={Tooltip} />;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vSC } from "vindur";
    import { Chart } from "#/components";
    const Tooltip = _vSC("div", "v1560qbr-1-Tooltip");
    export const A = () => <Chart css={Tooltip} />;
    "
  `);
});

test('should keep extensions of a styled component referenced as a value as runtime components', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';
      import { MoreMenu } from '#/components';

      const Button = styled.button\`
        color: red;
      \`;

      const LinkButton = styled(Button)\`
        text-decoration: none;
      \`;

      const DivButton = Button.withComponent('div');

      export const A = () => (
        <>
          <LinkButton />
          <DivButton />
          <MoreMenu buttonContainer={Button} />
        </>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vSC } from "vindur";
    import { MoreMenu } from "#/components";
    const Button = _vSC("button", "v1560qbr-1-Button");
    const LinkButton = _vSC("button", "v1560qbr-1-Button v1560qbr-2-LinkButton");
    const DivButton = _vSC("div", "v1560qbr-1-Button");
    export const A = () => (
      <>
        <LinkButton />
        <DivButton />
        <MoreMenu buttonContainer={Button} />
      </>
    );
    "
  `);
});

test('should not keep styled components only referenced in templates of an unimported styled', async () => {
  const result = await transformWithFormat({
    source: dedent`
      const Icon = styled.span\`
        color: red;
      \`;

      const Button = styled.button\`
        \${Icon} {
          color: blue;
        }
      \`;

      export const A = () => (
        <Button>
          <Icon />
        </Button>
      );
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const A = () => (
      <button className="v1560qbr-2-Button">
        <span className="v1560qbr-1-Icon" />
      </button>
    );
    "
  `);
});

test('should throw error for local bindings shadowing a styled component', async () => {
  await expect(async () => {
    await transformWithFormat({
      source: dedent`
        import { styled } from 'vindur';
        import type { ComponentType } from 'react';

        const Icon = styled.span\`
          color: red;
        \`;

        export const Button = ({ Icon }: { Icon: ComponentType }) => <Icon />;

        export const A = () => <Icon />;
      `,
    });
  }).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "Icon" shadows the styled component "Icon", rename this binding
    loc: 8:25]
  `);
});

test('should not keep styled components only referenced as types', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      type Icon = { size: number };

      const Icon = styled.span\`
        color: red;
      \`;

      export const A = (props: Icon) => <Icon />;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "type Icon = { size: number };
    export const A = (props: Icon) => <span className="v1560qbr-1-Icon" />;
    "
  `);
});
