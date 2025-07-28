import { useState } from 'react';
import { styled } from 'vindur';
import { DemoSection } from '../components/MainLayout';

const InteractiveCard = styled.div`
  padding: 16px;
  margin: 12px 0;
  border-radius: 8px;
  border: 2px solid transparent;
  background: #ff6b6b;
  color: white;
  cursor: pointer;
  transition: all 0.3s ease;
  
  &.active {
    background: #4ecdc4;
    transform: scale(1.05);
    box-shadow: 0 4px 12px rgba(76, 205, 196, 0.3);
  }
  
  &.disabled {
    background: #999;
    cursor: not-allowed;
    opacity: 0.6;
  }
  
  &.customClass {
    border-color: #667eea;
  }
`;

const ToggleButton = styled.button`
  padding: 8px 16px;
  margin-right: 8px;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s ease;
  
  &:hover {
    background: #5a6fd8;
  }
`;

const ButtonContainer = styled.div`
  margin-bottom: 16px;
`;

const InfoSection = styled.div`
  margin-top: 16px;
  font-size: 14px;
  color: white;
`;

const InfoList = styled.ul`
  margin-left: 20px;
`;

const InfoText = styled.div`
  margin-top: 8px;
`;

const StatusContainer = styled.div`
  font-size: 12px;
  margin-top: 8px;
`;

export function CxPropDemo() {
  const [isActive, setIsActive] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);

  return (
    <DemoSection title="4. CX Prop (Conditional Classes)">
      <ButtonContainer>
        <ToggleButton onClick={() => setIsDisabled(!isDisabled)}>
          Toggle Disabled: {isDisabled ? 'ON' : 'OFF'}
        </ToggleButton>
      </ButtonContainer>
      
      <InteractiveCard
        cx={{
          active: isActive,
          disabled: isDisabled,
          $customClass: true,
        }}
        onClick={() => !isDisabled && setIsActive(!isActive)}
      >
        <div>Status: {isActive ? 'Active' : 'Inactive'}</div>
        <div>Disabled: {isDisabled ? 'Yes' : 'No'}</div>
        <StatusContainer>
          {!isDisabled ? 'Click to toggle active state' : 'Disabled - cannot toggle'}
        </StatusContainer>
      </InteractiveCard>

      <InfoSection>
        <div>The cx prop adds conditional classes to the styled component:</div>
        <InfoList>
          <li><code>active</code> → hashed class name when isActive is true</li>
          <li><code>disabled</code> → hashed class name when isDisabled is true</li>
          <li><code>$customClass</code> → "customClass" (not hashed, $ prefix removed)</li>
        </InfoList>
        <InfoText>
          The styled component's CSS includes styles for these conditional classes.
        </InfoText>
      </InfoSection>
    </DemoSection>
  );
}
