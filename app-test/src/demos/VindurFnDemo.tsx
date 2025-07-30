import {
  primaryButton,
  secondaryButton,
  dangerButton,
  colorBox,
  spacing,
} from '#src/demos/functions';
import { styled } from 'vindur';
import { DemoSection } from '../components/MainLayout';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const SpacingContainer = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
`;

const SpacingExample1 = styled.div`
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: white;
  padding: 8px;
  ${spacing(1)};
`;

const SpacingExample2 = styled.div`
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: white;
  padding: 8px;
  ${spacing(3)};
`;

const ColorBoxContainer = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
`;

const ColorBox1 = styled.div`
  ${colorBox('#ff6b6b', 40)};
`;

const ColorBox2 = styled.div`
  ${colorBox('#4ecdc4', 60)};
`;

const ColorBox3 = styled.div`
  ${colorBox('#667eea', 80)};
`;

const ButtonContainer = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
`;

const PrimaryButton = styled.button`
  ${primaryButton()};
`;

const SecondaryButton = styled.button`
  ${secondaryButton()};
`;

const DangerButton = styled.button`
  ${dangerButton()};
`;

export function VindurFnDemo() {
  return (
    <DemoSection title="VindurFn Utilities">
      <Container>
        <div>
          <SpacingContainer>
            <SpacingExample1>Spacing x1</SpacingExample1>
            <SpacingExample2>Spacing x3</SpacingExample2>
          </SpacingContainer>
        </div>

        <div>
          <ColorBoxContainer>
            <ColorBox1 />
            <ColorBox2 />
            <ColorBox3 />
          </ColorBoxContainer>
        </div>

        <div>
          <ButtonContainer>
            <PrimaryButton>Primary</PrimaryButton>
            <SecondaryButton>Secondary</SecondaryButton>
            <DangerButton>Danger</DangerButton>
          </ButtonContainer>
        </div>
      </Container>
    </DemoSection>
  );
}
