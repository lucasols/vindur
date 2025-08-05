/* eslint-disable @typescript-eslint/no-unsafe-member-access -- some tests need to be invalid */
import { typingTest } from '@ls-stack/utils/typingTestUtils';
import { useRef, type CSSProperties } from 'react';
import { createDynamicCssColor, styled } from '../../src/main';

const { describe, test, expectTypesAre } = typingTest;

const dynamicColor = createDynamicCssColor();

describe('main runtime', () => {
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

    const StyledComponent2 = styled.div`
      ${
        // @ts-expect-error invalid forwardRef, only styled components can be used in forwardRef
        () => Component
      } {
        color: green;
      }
    `;

    const StyledComponent3 = styled.div`
      content: ${
        // @ts-expect-error invalid dynamic interpolation
        (props) => (props.test ? 1 : 2)
      };
    `;

    function Component() {
      return <div />;
    }
  });

  test('styled components extension', () => {
    const StyledComponent = styled.input`
      color: red;
    `;

    const StyledComponentExtended = styled(StyledComponent)`
      text-align: center;
    `;

    const inputRef = useRef<HTMLInputElement>(null);

    const inputElement = (
      <StyledComponentExtended
        // should have all props from extended component
        type="text"
        value="test"
        onChange={() => {}}
        ref={inputRef}
        // should have cx and css props from parent
        css="test"
        cx={{ test: true }}
      />
    );
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
        // should have css and cx vindur attributes
        css="test"
        cx={{ test: true }}
      />
    );
  });
});
