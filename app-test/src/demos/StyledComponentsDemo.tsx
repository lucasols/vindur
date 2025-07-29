import { styled } from 'vindur';
import { DemoSection } from '../components/MainLayout';

// Non-exported styled components (inlined directly)
const StyledButton = styled.button`
  background: linear-gradient(45deg, #4ecdc4, #44a08d);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-right: 12px;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(68, 160, 141, 0.4);
  }
`;

const PrimaryButton = styled.button`
  background: linear-gradient(45deg, #667eea, #764ba2);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-right: 12px;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
  }
`;

const SecondaryButton = styled.button`
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border: 2px solid rgba(255, 255, 255, 0.3);
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-right: 12px;

  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }
`;

const ButtonContainer = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
`;

// Exported styled component (generates intermediate component)
export const ExportedCard = styled.div`
  padding: 16px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  border-radius: 12px;
  text-align: center;
  font-weight: 600;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
  margin: 8px 0;
  transition: all 0.2s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
  }
`;

// attrs demo - styled components with default attributes
const AttrsButton = styled.button.attrs({
  type: 'button',
  'data-component': 'attrs-button',
  'aria-label': 'Button with attrs'
})`
  background: linear-gradient(45deg, #ff6b6b, #ee5a24);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-right: 12px;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(255, 107, 107, 0.4);
  }
`;

const AttrsInput = styled.input.attrs({
  type: 'text',
  placeholder: 'Input with attrs...',
  'data-testid': 'attrs-input'
})`
  padding: 12px 16px;
  border: 2px solid #667eea;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  transition: all 0.2s ease;
  margin-right: 12px;
  margin-bottom: 12px;

  &:focus {
    border-color: #764ba2;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }
`;

// withComponent demo - reusing styles across different elements
const BaseButton = styled.button`
  background: linear-gradient(45deg, #2ed573, #1e90ff);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  text-decoration: none;
  display: inline-block;
  margin-right: 12px;
  margin-bottom: 12px;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(46, 213, 115, 0.4);
  }
`;

const LinkButton = BaseButton.withComponent('a');
const SpanButton = BaseButton.withComponent('span');

const DemoContainer = styled.div`
  margin-bottom: 24px;
`;

const DemoTitle = styled.h3`
  color: white;
  margin-bottom: 12px;
  font-size: 18px;
`;

export function StyledComponentsDemo() {
  return (
    <DemoSection title="Styled Components">
      <ButtonContainer>
        <PrimaryButton>Primary Styled</PrimaryButton>
        <SecondaryButton>Secondary Styled</SecondaryButton>
        <StyledButton>Gradient Styled</StyledButton>
      </ButtonContainer>

      <ExportedCard>
        This is an exported styled component that generates an intermediate
        React component
      </ExportedCard>

      <DemoContainer>
        <DemoTitle>Attrs Demo - Components with Default Attributes</DemoTitle>
        <div>
          <AttrsButton>Button with attrs</AttrsButton>
          <AttrsInput />
        </div>
        <p style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '14px', margin: '8px 0' }}>
          The button has type="button", data-component="attrs-button", and aria-label attributes.
          The input has type="text", placeholder, and data-testid attributes.
        </p>
      </DemoContainer>

      <DemoContainer>
        <DemoTitle>withComponent Demo - Reusing Styles Across Elements</DemoTitle>
        <div>
          <BaseButton>Base Button</BaseButton>
          <LinkButton href="#demo" onClick={(e) => e.preventDefault()}>Link Button</LinkButton>
          <SpanButton>Span Button</SpanButton>
        </div>
        <p style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '14px', margin: '8px 0' }}>
          Same styles applied to button, anchor, and span elements using withComponent method.
        </p>
      </DemoContainer>
    </DemoSection>
  );
}
