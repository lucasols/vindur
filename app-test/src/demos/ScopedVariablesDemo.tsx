import { useState } from 'react';
import { css, styled } from 'vindur';
import { DemoSection } from '../components/MainLayout';

const style = css`
  ---gradientStart: #667eea;
  ---gradientEnd: #764ba2;
  ---textColor: white;
  ---shadowColor: rgba(102, 126, 234, 0.3);

  background: linear-gradient(
    45deg,
    var(---gradientStart),
    var(---gradientEnd)
  );
  color: var(---textColor);
  padding: 16px;
  border-radius: 8px;
  text-align: center;
  margin: 12px 0;
  box-shadow: 0 4px 15px var(---shadowColor);
`;

const StyledDiv = styled.div`
  ---padding: 16px;
  ---borderRadius: 8px;
  
  padding: var(---padding);
  border-radius: var(---borderRadius);
  background: var(---color);
  color: white;
  text-align: center;
  margin: 12px 0;
  font-weight: 600;
`;

export function ScopedVariablesDemo() {
  const [color, setColor] = useState('#a8e6cf');

  return (
    <DemoSection title="Scoped CSS Variables">
      <div
        css={`
          ---demoColor: #a8e6cf;
          ---demoPadding: 20px;
          ---demoRadius: 12px;

          background: var(---demoColor);
          padding: var(---demoPadding);
          border-radius: var(---demoRadius);
          color: #2d3748;
          font-weight: 600;
          text-align: center;
          margin: 12px 0;
        `}
      >
        Scoped CSS variables with css prop
      </div>

      <div className={style}>
        Scoped CSS variables with css template tag
      </div>

      <StyledDiv
        style={{
          '---color': color,
        }}
      >
        Dynamic scoped variables with styled component
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          css={`margin-left: 12px;`}
        />
      </StyledDiv>
    </DemoSection>
  );
}
