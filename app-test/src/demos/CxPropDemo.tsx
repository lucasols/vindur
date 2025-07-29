import { useState } from 'react';
import { cx, styled } from 'vindur';
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


const ButtonContainer = styled.div`
  margin-bottom: 16px;
`;


const StatusContainer = styled.div`
  font-size: 12px;
  margin-top: 8px;
`;

export function CxPropDemo() {
  const [isActive, setIsActive] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);

  return (
    <DemoSection title="CX Prop">
      <ButtonContainer>
        <button
          onClick={() => setIsDisabled(!isDisabled)}
          css={`
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
          `}
        >
          Toggle Disabled: {isDisabled ? 'ON' : 'OFF'}
        </button>
      </ButtonContainer>

      <InteractiveCard
        {...({
          cx: {
            active: isActive,
            disabled: isDisabled,
            $customClass: true,
          },
          onClick: () => !isDisabled && setIsActive(!isActive),
        } as any)}
      >
        <div>Status: {isActive ? 'Active' : 'Inactive'}</div>
        <div>Disabled: {isDisabled ? 'Yes' : 'No'}</div>
        <StatusContainer>
          {!isDisabled ?
            'Click to toggle active state'
          : 'Disabled - cannot toggle'}
        </StatusContainer>
      </InteractiveCard>

      <div
        className={cx('base-class', {
          'active-state': isActive,
          'disabled-state': isDisabled,
        })}
        css={`
          padding: 12px;
          margin: 12px 0;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          text-align: center;
          transition: all 0.3s ease;

          &.active-state {
            background: rgba(76, 205, 196, 0.3);
          }

          &.disabled-state {
            opacity: 0.5;
          }
        `}
      >
        cx() function for conditional class merging
      </div>

    </DemoSection>
  );
}
