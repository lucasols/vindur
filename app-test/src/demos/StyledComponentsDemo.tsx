import { styled, vindurFn } from 'vindur';
import { DemoSection } from '../components/MainLayout';

// VindurFn utility functions
const buttonStyles = vindurFn(
  (variant: 'primary' | 'secondary') => `
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  
  ${
    variant === 'primary' ?
      `
    background: linear-gradient(45deg, #ff6b6b, #ee5a24);
    color: white;
    box-shadow: 0 4px 15px rgba(255, 107, 107, 0.3);
    
    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(255, 107, 107, 0.4);
    }
  `
    : `
    background: rgba(255, 255, 255, 0.1);
    color: white;
    border: 2px solid rgba(255, 255, 255, 0.3);
    backdrop-filter: blur(10px);
    
    &:hover {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.5);
    }
  `
  }
`,
);

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

const ButtonContainer = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
`;

export function StyledComponentsDemo() {
  return (
    <DemoSection title="2. Styled Components">
      <ButtonContainer>
        <button className={buttonStyles('primary')}>
          Primary Button (vindurFn)
        </button>
        <button className={buttonStyles('secondary')}>
          Secondary Button (vindurFn)
        </button>
        <StyledButton>Styled Component</StyledButton>
      </ButtonContainer>
    </DemoSection>
  );
}
