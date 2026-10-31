import { dedent } from '@ls-stack/utils/dedent';
import { compactSnapshot } from '@ls-stack/utils/testUtils';
import { expect, test } from 'vitest';
import type { TransformWarning } from '../src/transform';
import { transformWithFormat } from './testUtils';

async function getWarnings(source: string) {
  const warnings: TransformWarning[] = [];
  await transformWithFormat({
    source,
    onWarning: (warning) => warnings.push(warning),
  });
  return compactSnapshot(warnings);
}

test('should warn when the component is rendered without class props', async () => {
  expect(
    await getWarnings(dedent`
      import { styled } from 'vindur'

      const Container = styled.div\`
        &.storiesPg { color: red; }
      \`

      export const App = () => <Container title="toasts"><span /></Container>
    `),
  ).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: "The class 'storiesPg' is used in CSS but not declared in the component"
        loc: 'current_file:3:6'
    "
  `);
});

test('should not warn when the className is set by a call', async () => {
  expect(
    await getWarnings(dedent`
      import { styled } from 'vindur'

      const classNames = (classes: Record<string, boolean>) =>
        Object.keys(classes).filter((key) => classes[key]).join(' ')

      const Container = styled.div\`
        &.storiesPg { color: red; }
      \`

      export const App = ({ storiesPg }: { storiesPg: boolean }) => (
        <Container className={classNames({ storiesPg })} />
      )
    `),
  ).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});

test('should not warn when the className is a variable', async () => {
  expect(
    await getWarnings(dedent`
      import { styled } from 'vindur'

      const Arrow = styled.div\`
        &.left { left: 0; }
        &.right { right: 0; }
      \`

      export const App = ({ side }: { side: 'left' | 'right' }) => <Arrow className={side} />
    `),
  ).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});

test('should not warn when the component receives spread props', async () => {
  expect(
    await getWarnings(dedent`
      import { styled } from 'vindur'

      const Container = styled.div\`
        &.active { color: red; }
      \`

      export const App = (props: { className: string }) => <Container {...props} />
    `),
  ).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});

test('should not warn when the component is used outside of JSX', async () => {
  expect(
    await getWarnings(dedent`
      import { styled } from 'vindur'

      const Container = styled.div\`
        &.active { color: red; }
      \`

      export const components = { Container }
    `),
  ).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});

test('should not warn when the component is exported', async () => {
  expect(
    await getWarnings(dedent`
      import { styled } from 'vindur'

      export const Container = styled.div\`
        &.active { color: red; }
      \`
    `),
  ).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});

test('should not warn about classes of an ancestor', async () => {
  expect(
    await getWarnings(dedent`
      import { styled } from 'vindur'

      const Tools = styled.div\`
        .isCollapsed & { display: none; }
      \`

      export const App = () => <Tools />
    `),
  ).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});

test('should still warn when the component is only referenced as a type', async () => {
  expect(
    await getWarnings(dedent`
      import { styled } from 'vindur'

      const Container = styled.div\`
        &.active { color: red; }
      \`

      export type ContainerType = typeof Container

      export const App = () => <Container />
    `),
  ).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: "The class 'active' is used in CSS but not declared in the component"
        loc: 'current_file:3:6'
    "
  `);
});

test('should not warn when the component receives a css prop', async () => {
  expect(
    await getWarnings(dedent`
      import { css, styled } from 'vindur'

      const highlight = css\`
        color: red;
      \`

      const Container = styled.div\`
        &.active { color: red; }
      \`

      export const App = () => <Container css={highlight} />
    `),
  ).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});

test('should not warn when the component sets attrs', async () => {
  expect(
    await getWarnings(dedent`
      import { styled } from 'vindur'

      const Container = styled.div.attrs({ className: 'active' })\`
        &.active { color: red; }
      \`

      export const App = () => <Container />
    `),
  ).toMatchInlineSnapshot(`
    "
    []
    "
  `);
});

test('should warn when an svg component only receives the native cx coordinate', async () => {
  expect(
    await getWarnings(dedent`
      import { styled } from 'vindur'

      const Dot = styled.circle\`
        &.active { fill: red; }
      \`

      export const App = () => <svg><Dot cx="50" cy="50" r="4" /></svg>
    `),
  ).toMatchInlineSnapshot(`
    "
    - TransformWarning#:
        message: "The class 'active' is used in CSS but not declared in the component"
        loc: 'current_file:3:6'
    "
  `);
});
