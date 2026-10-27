import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { transformWithFormat } from '../testUtils';

test('should hoist attrs reused by derived styled components to evaluate them once', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      let lastId = 0
      const nextId = () => String(++lastId)

      export const Button = styled.button.attrs({ id: nextId() })\`
        color: red;
      \`

      const IconButton = styled(Button).attrs({ title: nextId() })\`
        padding: 0;
      \`

      const IconLink = IconButton.withComponent('a')

      const Single = styled.span.attrs({ id: nextId() })\`
        color: blue;
      \`

      export const App = () => (
        <>
          <IconButton />
          <IconLink />
          <Single />
        </>
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { _vSC } from "vindur";
    let lastId = 0;
    const nextId = () => String(++lastId);
    const _vButtonAttrs = {
      id: nextId(),
    };
    export const Button = _vSC("button", "v1560qbr-1-Button", _vButtonAttrs);
    const _vIconButtonAttrs = {
      ..._vButtonAttrs,
      ...{
        title: nextId(),
      },
    };
    const IconButton = _vSC(
      "button",
      "v1560qbr-1-Button v1560qbr-2-IconButton",
      _vIconButtonAttrs,
    );
    const IconLink = _vSC(
      "a",
      "v1560qbr-1-Button v1560qbr-2-IconButton",
      _vIconButtonAttrs,
    );
    const Single = _vSC("span", "v1560qbr-3-Single", {
      id: nextId(),
    });
    export const App = () => (
      <>
        <IconButton />
        <IconLink />
        <Single />
      </>
    );
    "
  `);
});

test('should throw error for bindings using the name of hoisted attrs', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const _vButtonAttrs = 1

        const Button = styled.button.attrs({ type: 'button' })\`
          color: red;
        \`

        const IconButton = styled(Button)\`
          padding: 0;
        \`

        export const App = () => <IconButton />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: "_vButtonAttrs" is reserved by vindur for generated code, rename this binding. Names starting with _v are reserved
    loc: 3:6]
  `);
});
