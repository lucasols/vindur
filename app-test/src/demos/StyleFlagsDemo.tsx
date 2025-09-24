import { useState } from 'react';
import { styled } from 'vindur';
import { DemoSection } from '../components/MainLayout';

const StyledButton = styled.button<{
  active: boolean;
  size: 'small' | 'medium' | 'large';
  variant: 'primary' | 'secondary' | 'danger';
}>`
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-weight: 600;
  margin: 4px;

  /* Style flags - boolean prop */
  &.active {
    transform: scale(1.05);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  /* Style flags - string union prop values */
  &.size-small {
    padding: 6px 12px;
    font-size: 12px;
  }

  &.size-medium {
    padding: 10px 20px;
    font-size: 14px;
  }

  &.size-large {
    padding: 14px 28px;
    font-size: 16px;
  }

  &.variant-primary {
    background: linear-gradient(45deg, #667eea, #764ba2);
    color: white;
  }

  &.variant-secondary {
    background: linear-gradient(45deg, #4ecdc4, #44a08d);
    color: white;
  }

  &.variant-danger {
    background: linear-gradient(45deg, #ff6b6b, #ee5a24);
    color: white;
  }
`;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const ButtonGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
`;

const Controls = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
`;

const ControlGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.label`
  color: white;
  font-size: 14px;
  font-weight: 600;
`;

export function StyleFlagsDemo() {
  const [active, setActive] = useState(false);
  const [size, setSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [variant, setVariant] = useState<'primary' | 'secondary' | 'danger'>(
    'primary',
  );

  return (
    <DemoSection title="Style Flags">
      <Container>
        <Controls>
          <ControlGroup>
            <Label>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                css={`
                  margin-right: 8px;
                `}
                style={{
                  '--color': 'red',
                }}
              />
              Active State
            </Label>
          </ControlGroup>

          <ControlGroup>
            <Label>Size:</Label>
            <select
              value={size}
              onChange={(e) =>
                setSize(e.target.value as 'small' | 'medium' | 'large')
              }
              css={`
                padding: 4px 8px;
                border-radius: 4px;
                border: none;
                background: rgba(255, 255, 255, 0.9);
              `}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </ControlGroup>

          <ControlGroup>
            <Label>Variant:</Label>
            <select
              value={variant}
              onChange={(e) =>
                setVariant(e.target.value as 'primary' | 'secondary' | 'danger')
              }
              css={`
                padding: 4px 8px;
                border-radius: 4px;
                border: none;
                background: rgba(255, 255, 255, 0.9);
              `}
            >
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
              <option value="danger">Danger</option>
            </select>
          </ControlGroup>
        </Controls>

        <ButtonGrid>
          <StyledButton
            active={active}
            size={size}
            variant={variant}
          >
            Interactive Button
          </StyledButton>

          <StyledButton
            active={true}
            size="small"
            variant="primary"
          >
            Small Primary (Active)
          </StyledButton>

          <StyledButton
            active={false}
            size="medium"
            variant="secondary"
          >
            Medium Secondary
          </StyledButton>

          <StyledButton
            active={true}
            size="large"
            variant="danger"
          >
            Large Danger (Active)
          </StyledButton>
        </ButtonGrid>
      </Container>
    </DemoSection>
  );
}
