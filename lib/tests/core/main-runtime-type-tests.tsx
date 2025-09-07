/**
 * @fileoverview This a test file for checking the types only, it does not test the runtime behavior.
 * Also, it should not test the compile helpers, just user related functionality.
 *
 * Just run tsc to test it.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment -- some tests need to be invalid */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- some tests need to be invalid */
import { typingTest } from '@ls-stack/utils/typingTestUtils';
import {
  forwardRef,
  useRef,
  type ComponentProps,
  type CSSProperties,
} from 'react';
import {
  createDynamicCssColor,
  createStaticThemeColors,
  css,
  keyframes,
  layer,
  stableId,
  styled,
  vindurFn,
} from '../../src/main';

const { describe, test, expectTypesAre } = typingTest;

const dynamicColor = createDynamicCssColor();

test('styled components', () => {
  const value = 'test';
  const numberValue = 100;

  const StyledComponent = styled.img`
    color: red;
    /* supports string interpolation */
    height: ${value};
    /* supports number interpolation */
    width: ${numberValue};
    /* supports forwardRef */
    ${() => StyledComponent2} {
      color: green;
    }
  `;

  const StyledComponent2 = styled.input`
    color: blue;
  `;

  const imgRef = useRef<HTMLImageElement>(null);

  const imgElement = (
    <StyledComponent
      // inherit all props from img element
      src="https://example.com/image.png"
      sizes="100vw"
      width={100}
      height={100}
      srcSet="test test"
      ref={imgRef}
      // inherit all dom element props
      id="test"
      className="test"
      // has all vindur attributes
      css="test"
      cx={{ test: true }}
      dynamicColor={dynamicColor.set('red')}
    />
  );

  const inputRef = useRef<HTMLInputElement>(null);

  const inputElement = (
    <StyledComponent2
      type="text"
      value="test"
      onChange={() => {}}
      ref={inputRef}
    />
  );
});

test('invalid interpolations', () => {
  const StyledComponent = styled.img`
    height: ${
      // @ts-expect-error invalid object interpolation
      { test: 1 }
    };
  `;
});

test('styled components extension', () => {
  const StyledComponent = styled.input`
    color: red;
  `;

  const StyledComponentExtended = styled(StyledComponent)`
    text-align: center;
  `;

  expectTypesAre<
    ComponentProps<typeof StyledComponentExtended>,
    ComponentProps<typeof StyledComponent>
  >('equal');

  const inputRef = useRef<HTMLInputElement>(null);

  const inputElement = (
    <StyledComponentExtended
      // should have all props from extended component
      type="text"
      value="test"
      onChange={() => {}}
      ref={inputRef}
      // should have cx, css and dynamicColor props from parent
      css="test"
      cx={{ test: true }}
      dynamicColor={dynamicColor.set('red')}
    />
  );
});

test('styled components reference', () => {
  function ComponentWithoutClassname() {
    return <div />;
  }

  const Styled = styled.div`
    color: red;
  `;

  const Styled2 = styled(Styled)`
    color: blue;

    ${Styled}:hover & {
      color: green;
    }
  `;

  const style = css`
    ${Styled}:hover & {
      color: green;
    }

    ${Styled2}:hover & {
      color: yellow;
    }
  `;
});

test('styled components from custom components with className', () => {
  function Component({ className }: { className?: string }) {
    return <div className={className} />;
  }

  const Styled = styled(Component)`
    color: red;
  `;

  const divElement = (
    <Styled
      className="test"
      // should have css and cx vindur attributes
      css="test"
      cx={{ test: true }}
      // @ts-expect-error when component not have `style` prop, dynamicColor is not supported
      dynamicColor={dynamicColor.set('red')}
    />
  );
});

test('styled components from custom components with style and className', () => {
  function Component({
    style,
    className,
  }: {
    style?: CSSProperties;
    className?: string;
  }) {
    return (
      <div
        style={style}
        className={className}
      />
    );
  }

  const Styled = styled(Component)`
    color: red;
  `;

  const divElement = (
    <Styled
      style={{ color: 'blue' }}
      className="test"
      // should have css, cx and dynamicColor vindur attributes
      css="test"
      cx={{ test: true }}
      dynamicColor={dynamicColor.set('red')}
    />
  );
});

test('styled components from custom components without className should not be supported', () => {
  function Component() {
    return <div />;
  }

  // @ts-expect-error when component not have `className` prop, styled() is not supported
  const Styled = styled(Component)`
    color: red;
  `;
});

test('styled component from ForwardRef components', () => {
  const Component = forwardRef<HTMLDivElement, { className?: string }>(
    (props, ref) => {
      return (
        <div
          ref={ref}
          className={props.className}
        />
      );
    },
  );

  const Styled = styled(Component)`
    color: red;
  `;

  const divElement = (
    <Styled
      className="test"
      ref={useRef<HTMLDivElement>(null)}
      // should have css and cx vindur attributes
      css="test"
      cx={{ test: true }}
      // @ts-expect-error when component not have `style` prop, dynamicColor is not supported
      dynamicColor={dynamicColor.set('red')}
    />
  );
});

test('withComponent on intrinsic elements', () => {
  const Base = styled.button`
    color: red;
  `;

  const AsLink = Base.withComponent('a');

  const ok = (
    <AsLink
      href="https://example.com"
      target="_blank"
      css="test"
      cx={{ active: true }}
      dynamicColor={dynamicColor.set('red')}
    />
  );

  // @ts-expect-error anchor does not accept `rows` prop
  const invalid = <AsLink rows={2} />;
});

test('withComponent on custom components preserves target component props', () => {
  type CompProps = {
    className: string | undefined;
    style: CSSProperties | undefined;
    custom: number;
  };
  function Comp(props: CompProps) {
    return (
      <div
        className={props.className}
        style={props.style}
        data-custom={props.custom}
      />
    );
  }

  const Base = styled.div`
    color: blue;
  `;

  const Replaced = Base.withComponent(Comp);

  const ok = (
    <Replaced
      custom={1}
      className="x"
      style={{ display: 'block' }}
    />
  );

  const invalidCss = (
    <Replaced
      custom={1}
      // @ts-expect-error returned component is `Comp`, it does not accept css prop
      css="x"
    />
  );
});

test('styled.attrs chaining with extra props', () => {
  const Styled = styled.div.attrs({ role: 'button', tabIndex: 0 })<{
    extra: string;
  }>`
    color: red;
  `;

  const ok = <Styled extra="x" />;
  // @ts-expect-error extra is required
  const invalid = <Styled />;
});

test('styled generics add required props', () => {
  const Styled = styled.span<{ required: boolean }>`
    color: green;
  `;

  const ok = <Styled required={!!1} />;
  // @ts-expect-error missing required prop
  const invalid = <Styled />;
});

test('invalid css and cx prop types', () => {
  const Styled = styled.div`
    color: red;
  `;
  // @ts-expect-error css must be string
  const invalidCss = <Styled css={123} />;
  // @ts-expect-error cx must be an object
  const invalidCx = <Styled cx={'active'} />;
});

test('vindurFn typing', () => {
  const fn = vindurFn((a: number, b: string) => `w:${a}px; c:${b};`);
  expectTypesAre<ReturnType<typeof fn>, `w:${number}px; c:${string};`>('equal');
  expectTypesAre<Parameters<typeof fn>[0], number>('equal');
  expectTypesAre<Parameters<typeof fn>[1], string>('equal');

  // @ts-expect-error return type must be string
  const invalid = vindurFn((x: number) => 123);
});

test('createStaticThemeColors typing', () => {
  const theme = createStaticThemeColors({
    primary: '#112233',
    accent: '#abcdef',
  } as const);

  expectTypesAre<typeof theme.primary.defaultHex, '#112233'>('equal');
  expectTypesAre<ReturnType<typeof theme.primary.alpha>, string>('equal');
  expectTypesAre<ReturnType<typeof theme.accent.contrast.optimal>, string>(
    'equal',
  );
});

test('keyframes, layer and stableId return strings', () => {
  const kf = keyframes`
      from { opacity: 0 }
      to { opacity: 1 }
    `;
  expectTypesAre<typeof kf, string>('equal');

  const l = layer('base');
  expectTypesAre<typeof l, string>('equal');

  const id = stableId();
  expectTypesAre<typeof id, string>('equal');
});

describe('style flags', () => {
  test('style flags typing', () => {
    const Styled = styled.div<{ active: boolean }>`
      color: red;
    `;

    const ok = <Styled active={true} />;
    // @ts-expect-error active must be boolean
    const invalid = <Styled active={1} />;

    // @ts-expect-error missing required prop
    const withRequired = <Styled />;
  });

  test('style flags with optional typing', () => {
    const Styled = styled.div<{ active?: boolean }>`
      color: red;
    `;
  });

  test('style flags with string union typing', () => {
    const Styled = styled.div<{ size: 'small' | 'large' }>`
      color: red;
    `;

    const ok = <Styled size="small" />;
    // @ts-expect-error size must be 'small' or 'large'
    const invalid = <Styled size="medium" />;
  });

  test('style flags with invalid typing', () => {
    // @ts-expect-error flag params only support boolean and string union
    const Styled = styled.div<{ active: { test: number } }>`
      color: red;
    `;
  });

  test('style flags with component extension', () => {
    function Component({ className }: { className?: string }) {
      return <div className={className} />;
    }

    const Styled = styled(Component)<{ active: boolean }>`
      color: red;
    `;

    const ok = <Styled active={true} />;
    // @ts-expect-error missing required prop
    const invalid = <Styled />;
  });
});
