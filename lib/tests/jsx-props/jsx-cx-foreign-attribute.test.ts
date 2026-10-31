import { dedent } from '@ls-stack/utils/dedent';
import { expect, test } from 'vitest';
import { createFsMock, transformWithFormat } from '../testUtils';

test('should keep the native cx attribute of svg elements', async () => {
  const result = await transformWithFormat({
    source: dedent`
      const size = 100

      export const Progress = () => (
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="20" />
          <ellipse cx={size} cy={size} rx="10" ry="5" />
          <radialGradient id="g" cx="50%" cy="50%" />
        </svg>
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "const size = 100;
    export const Progress = () => (
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="20" />
        <ellipse cx={size} cy={size} rx="10" ry="5" />
        <radialGradient id="g" cx="50%" cy="50%" />
      </svg>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`""`);
});

test('should keep cx and string css props of custom components', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { Pie } from 'recharts'

      export const Chart = () => <Pie cx="50%" cy="50%" outerRadius={80} css="pie" />
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { Pie } from "recharts";
    export const Chart = () => <Pie cx="50%" cy="50%" outerRadius={80} css="pie" />;
    "
  `);
});

test('should still apply vindur cx objects on svg elements', async () => {
  const result = await transformWithFormat({
    source: dedent`
      export const Dot = ({ active }: { active: boolean }) => (
        <circle cx={{ $active: active }} r="2" />
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const Dot = ({ active }: { active: boolean }) => (
      <circle r="2" className={active ? "active" : ""} />
    );
    "
  `);
});

test('should still throw for non object cx on html elements', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        export const Box = () => <div cx="active" />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop must be an expression container with an object
    loc: 1:30]
  `);
});

test('should not fail when importing a file that uses svg cx attributes', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { css } from 'vindur'
      import { CircularProgress } from '#/CircularProgress'

      const style = css\`
        color: red;
      \`

      export const Icon = () => <CircularProgress className={style} />
    `,
    overrideDefaultFs: createFsMock({
      'CircularProgress.tsx': dedent`
        export const CircularProgress = ({ className }: { className: string }) => (
          <svg className={className}>
            <circle cx="50" cy="50" r="20" />
          </svg>
        )
      `,
    }),
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { CircularProgress } from "#/CircularProgress";
    const style = "v1560qbr-1-style";
    export const Icon = () => <CircularProgress className={style} />;
    "
  `);
});

test('should keep the native cx attribute of styled svg elements', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'

      const Dot = styled.circle\`
        fill: red;
      \`

      export const Chart = () => (
        <svg>
          <Dot cx="50" cy="50" r="4" />
          <Dot cx={50} />
        </svg>
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "export const Chart = () => (
      <svg>
        <circle cx="50" cy="50" r="4" className="v1560qbr-1-Dot" />
        <circle cx={50} className="v1560qbr-1-Dot" />
      </svg>
    );
    "
  `);
});

test('should throw for non object cx and string css on styled custom components', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { Pie } from 'recharts'

        const StyledPie = styled(Pie)\`
          opacity: 0.5;
        \`

        export const Chart = () => <StyledPie cx="50%" />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop must be an expression container with an object
    loc: 8:38]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { motion } from 'motion/react'

        const Ring = styled(motion.circle)\`
          stroke: red;
        \`

        export const Chart = () => <Ring cx={50} />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop only accepts object expressions
    loc: 8:37]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'
        import { Pie } from 'recharts'

        const StyledPie = styled(Pie)\`
          opacity: 0.5;
        \`

        export const Chart = () => <StyledPie css="pie" />
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid css prop value. Only template literals and references to css function calls are supported
    loc: 8:38]
  `);
});

test('should still throw for wrapped or conditional cx objects on svg elements', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        export const Dot = ({ active }: { active: boolean }) => (
          <circle cx={({ $active: active }) as const} r="2" />
        )
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop only accepts object expressions
    loc: 2:14]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        export const Dot = ({ active }: { active: boolean }) => (
          <circle cx={active ? { $active: true } : {}} r="2" />
        )
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop only accepts object expressions
    loc: 2:14]
  `);

  await expect(
    transformWithFormat({
      source: dedent`
        export const Dot = ({ active }: { active: boolean }) => (
          <circle cx={(track(), { $active: active })} r="2" />
        )
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop only accepts object expressions
    loc: 2:14]
  `);
});

test('should throw for cx objects on member expression components', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import * as R from 'recharts'

        export const Chart = ({ active }: { active: boolean }) => (
          <R.Pie cx={{ active }} />
        )
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: cx prop is not supported on custom component "R.Pie". The cx prop only works on native DOM elements (like div, span, button) and styled components.
    loc: 4:2]
  `);
});

test('should not allocate a class index for custom component cx with a string css prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import * as R from 'recharts'
      import { Pie } from 'recharts'

      export const Chart = () => (
        <>
          <Pie cx="50%" css="pie" />
          <R.Pie cx="50%" css="pie" />
          <div css={\`color: blue;\`} />
        </>
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import * as R from "recharts";
    import { Pie } from "recharts";
    export const Chart = () => (
      <>
        <Pie cx="50%" css="pie" />
        <R.Pie cx="50%" css="pie" />
        <div className="v1560qbr-1-css-prop-1" />
      </>
    );
    "
  `);
});

test('should apply cx classes of styled custom components with a forwarded css prop', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      import { Pie } from 'recharts'

      const StyledPie = styled(Pie)\`
        opacity: 0.5;

        &.active {
          opacity: 1;
        }
      \`

      export const Chart = ({ active, label }: { active: boolean; label: string }) => (
        <>
          <StyledPie cx={{ active }} css={label} />
          <div css={\`color: blue;\`} />
        </>
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { Pie } from "recharts";
    export const Chart = ({
      active,
      label,
    }: {
      active: boolean;
      label: string;
    }) => (
      <>
        <Pie
          css={label}
          className={"v1560qbr-1-StyledPie" + (active ? " v1560qbr-2-active" : "")}
        />
        <div className="v1560qbr-4-css-prop-4" />
      </>
    );
    "
  `);

  expect(result.css).toMatchInlineSnapshot(`
    ".v1560qbr-1-StyledPie {
      opacity: 0.5;

      &.v1560qbr-2-active {
        opacity: 1;
      }
    }

    .v1560qbr-4-css-prop-4 {
      color: blue;
    }
    "
  `);
});

test('should import mergeClassNames for cx on styled custom components with spread props', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur'
      import { Pie } from 'recharts'

      const StyledPie = styled(Pie)\`
        opacity: 0.5;

        &.active {
          opacity: 1;
        }
      \`

      export const Chart = ({ active, ...props }: { active: boolean }) => (
        <StyledPie {...props} cx={{ active }} />
      )
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { mergeClassNames } from "vindur";
    import { Pie } from "recharts";
    export const Chart = ({ active, ...props }: { active: boolean }) => (
      <Pie
        {...props}
        className={mergeClassNames(
          [props],
          "v1560qbr-1-StyledPie" + (active ? " v1560qbr-2-active" : ""),
        )}
      />
    );
    "
  `);
});

test('should throw for non vindur css values on styled native elements', async () => {
  await expect(
    transformWithFormat({
      source: dedent`
        import { styled } from 'vindur'

        const Box = styled.div\`
          color: red;
        \`

        export const Card = ({ active }: { active: boolean }) => (
          <Box css={active ? \`color: blue;\` : \`color: green;\`} />
        )
      `,
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [TransformError: /test.tsx: Invalid css prop value. Only template literals and references to css function calls are supported
    loc: 8:12]
  `);
});

test('should keep cx and css props of underscore prefixed components', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { Pie as _Pie } from 'recharts';

      export const Chart = () => <_Pie cx="50%" css="pie" />;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { Pie as _Pie } from "recharts";
    export const Chart = () => <_Pie cx="50%" css="pie" />;
    "
  `);
});

test('should not let a cx prop variable shadow the cx helper', async () => {
  const result = await transformWithFormat({
    source: dedent`
      import { styled } from 'vindur';

      const Dot = styled.circle<{ active: boolean }>\`
        fill: red;
        &.active { fill: blue; }
      \`;

      export function Point({ cx, cy, active, p }) {
        return <Dot {...p} cx={cx} cy={cy} active={active} />;
      }

      export function App({ cx }) {
        return <div cx={{ $active: true }} />;
      }
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    "import { mergeClassNames } from "vindur";
    export function Point({ cx, cy, active, p }) {
      return (
        <circle
          {...p}
          cx={cx}
          cy={cy}
          className={
            mergeClassNames([p], "v1560qbr-1-Dot") +
            (active ? " voctcyj-active" : "")
          }
        />
      );
    }
    export function App({ cx }) {
      return <div className={"active"} />;
    }
    "
  `);
});

test('should insert the helper import after directives', async () => {
  const result = await transformWithFormat({
    source: dedent`
      'use client';

      export const App = ({ a }) => <div cx={{ $on: a }} />;
    `,
  });

  expect(result.code).toMatchInlineSnapshot(`
    ""use client";

    export const App = ({ a }) => <div className={a ? "on" : ""} />;
    "
  `);
});
