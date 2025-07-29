import { useState } from 'react';
import { createDynamicCssColor, styled } from 'vindur';
import { DemoSection } from '../components/MainLayout';

// Create dynamic colors
const primaryColor = createDynamicCssColor();
const accentColor = createDynamicCssColor();

const StyledCard = styled.div`
  padding: 20px;
  border-radius: 12px;
  margin: 12px 0;
  background: ${primaryColor.var};
  color: ${primaryColor.contrast.var};
  transition: all 0.3s ease;
  cursor: pointer;

  &:hover {
    background: ${primaryColor.darker(0.1)};
    transform: translateY(-2px);
  }

  ${primaryColor.self.isDark} {
    box-shadow: 0 4px 15px rgba(255, 255, 255, 0.1);
  }

  ${primaryColor.self.isLight} {
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
  }
`;

const AccentButton = styled.button`
  padding: 12px 24px;
  border: 2px solid ${accentColor.var};
  background: ${accentColor.alpha(0.1)};
  color: ${accentColor.var};
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  margin: 4px;
  transition: all 0.2s ease;

  &:hover {
    background: ${accentColor.var};
    color: ${accentColor.contrast.var};
  }

  ${accentColor.self.isVeryDark} {
    border-color: ${accentColor.lighter(0.3)};
    color: ${accentColor.lighter(0.3)};
  }
`;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const ColorControls = styled.div`
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 16px;
`;

const ColorControl = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.label`
  color: white;
  font-size: 14px;
  font-weight: 600;
`;



const ChildContainer = styled.div`
  padding: 16px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  
  ${primaryColor.container.isDark} {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  ${primaryColor.container.isLight} {
    background: rgba(0, 0, 0, 0.1);
    color: #333;
  }
`;

export function DynamicColorsDemo() {
  const [primaryHex, setPrimaryHex] = useState('#667eea');
  const [accentHex, setAccentHex] = useState('#4ecdc4');

  return (
    <DemoSection title="Dynamic Colors">
      <Container>

        <ColorControls>
          <ColorControl>
            <Label>Primary Color:</Label>
            <input
              type="color"
              value={primaryHex}
              onChange={(e) => setPrimaryHex(e.target.value)}
              css={`
                width: 60px;
                height: 40px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
              `}
            />
          </ColorControl>

          <ColorControl>
            <Label>Accent Color:</Label>
            <input
              type="color"
              value={accentHex}
              onChange={(e) => setAccentHex(e.target.value)}
              css={`
                width: 60px;
                height: 40px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
              `}
            />
          </ColorControl>
        </ColorControls>

        <StyledCard {...({ dynamicColor: primaryColor.set(primaryHex) } as any)}>
          <div>Primary color card with automatic contrast text</div>
          <div>Background adapts shadows based on light/dark detection</div>
          
          <ChildContainer>
            This child container uses container selectors to style based on 
            the parent's color properties
          </ChildContainer>
        </StyledCard>

        <div
          css={`
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          `}
        >
          <AccentButton {...({ dynamicColor: accentColor.set(accentHex) } as any)}>
            Accent Button
          </AccentButton>
          
          <AccentButton {...({ dynamicColor: accentColor.set('#1a1a1a') } as any)}>
            Very Dark Button
          </AccentButton>
          
          <AccentButton {...({ dynamicColor: accentColor.set('#f0f0f0') } as any)}>
            Light Button
          </AccentButton>
        </div>

        <div
          css={`
            padding: 12px;
            border-radius: 6px;
            background: ${primaryColor.lighter(0.8)};
            color: ${primaryColor.darker(0.6)};
            font-size: 14px;
          `}
          {...({ dynamicColor: primaryColor.set(primaryHex) } as any)}
        >
          Color manipulation functions: lighter background, darker text
        </div>
      </Container>
    </DemoSection>
  );
}