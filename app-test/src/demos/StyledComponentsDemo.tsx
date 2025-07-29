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
    </DemoSection>
  );
}
