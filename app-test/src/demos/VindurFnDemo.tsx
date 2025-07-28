import { vindurFn, styled } from 'vindur';
import { DemoSection } from '../components/MainLayout';

const spacing = vindurFn(
  (size: number) => `
  margin: ${size * 8}px;
  padding: ${size * 4}px;
`,
);

const colorBox = vindurFn(
  (color: string, size: number) => `
  background: ${color};
  width: ${size}px;
  height: ${size}px;
  border-radius: 8px;
  display: inline-block;
  margin: 8px;
  border: 2px solid white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
`,
);

const SpacingContainer = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
`;

const SpacingExample = styled.div`
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: white;
  padding: 8px;
`;

const ColorBoxContainer = styled.div`
  margin-top: 16px;
`;

export function VindurFnDemo() {
  return (
    <DemoSection title="5. VindurFn Utilities">
      <SpacingContainer>
        <SpacingExample className={spacing(2)}>
          Spacing utility (size: 2)
        </SpacingExample>
        <SpacingExample className={spacing(4)}>
          Spacing utility (size: 4)
        </SpacingExample>
      </SpacingContainer>

      <ColorBoxContainer>
        <div className={colorBox('#ff6b6b', 40)}></div>
        <div className={colorBox('#4ecdc4', 60)}></div>
        <div className={colorBox('#45b7d1', 50)}></div>
        <div className={colorBox('#f9ca24', 55)}></div>
      </ColorBoxContainer>
    </DemoSection>
  );
}
