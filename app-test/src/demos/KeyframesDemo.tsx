import { keyframes } from 'vindur';
import { DemoSection, CodeBlock } from '../components/MainLayout';

const fadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const pulse = keyframes`
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
`;

const rotate = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

export function KeyframesDemo() {
  return (
    <DemoSection title="7. Keyframes & Animations">
      <CodeBlock>{`const fadeIn = keyframes\`
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
\`;

const pulse = keyframes\`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
\`;`}</CodeBlock>
      
      <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
        <div 
          css={`
            width: 80px;
            height: 80px;
            background: linear-gradient(45deg, #667eea, #764ba2);
            border-radius: 50%;
            animation: ${fadeIn} 2s ease-in-out infinite alternate;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
          `}
        >
          Fade
        </div>
        
        <div 
          css={`
            width: 80px;
            height: 80px;
            background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
            border-radius: 50%;
            animation: ${pulse} 1.5s ease-in-out infinite;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
          `}
        >
          Pulse
        </div>
        
        <div 
          css={`
            width: 80px;
            height: 80px;
            background: linear-gradient(45deg, #f093fb, #f5576c);
            border-radius: 10px;
            animation: ${rotate} 3s linear infinite;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
          `}
        >
          Spin
        </div>
      </div>
    </DemoSection>
  );
}