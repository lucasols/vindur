import { dedent } from '@ls-stack/utils/dedent';
import { beforeEach, expect, test } from 'vitest';
import {
  checkTransformRule,
  clearTransformCaches,
} from '../src/rules/check-transform';
import {
  createVindurTester,
  getErrorsWithMsgFromResult,
} from './utils/createTester';

const { valid, invalid } = createVindurTester({
  name: 'check-transform',
  rule: checkTransformRule,
});

beforeEach(() => {
  clearTransformCaches();
});

const code = dedent`
  import { createDynamicCssColor, styled } from 'vindur';

  const bg = createDynamicCssColor();

  const Card = styled.div\`
    &.dm {
      color: white;
    }
  \`;

  export const App = ({ color }: { color: string }) => (
    <Card dynamicColor={bg.set(color, { setColorScheme: { fallback: 'dark' } })} />
  );
`;

test('should report scheme classes without the colorSchemeClassNames option', async () => {
  const { result } = await invalid({ code });

  expect(getErrorsWithMsgFromResult(result)).toMatchInlineSnapshot(`
    "
    - messageId: 'transformWarning'
      msg: "The class 'dm' is used in CSS but not declared in the component"
      loc: '5:7'
    "
  `);
});

test('should not report the configured scheme classes as undeclared', async () => {
  const { result } = await valid({
    code,
    options: [{ colorSchemeClassNames: { light: 'lm', dark: 'dm' } }],
  });

  expect(result.messages).toEqual([]);
});

test('should fail on invalid colorSchemeClassNames', async () => {
  await expect(
    invalid({
      code,
      options: [{ colorSchemeClassNames: { light: 'lm', dark: 'dm dark' } }],
    }),
  ).rejects.toThrow(
    'colorSchemeClassNames.dark must be a single class name, got "dm dark"',
  );
});
