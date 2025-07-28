import { useState } from 'react';
import { css } from 'vindur';
import { DemoSection, CodeBlock } from '../components/MainLayout';

export function CxPropDemo() {
  const [isActive, setIsActive] = useState(false);

  return (
    <DemoSection title="4. CX Prop (Conditional Classes)">
      <CodeBlock>{`<div cx={{
  active: isActive,
  'theme-dark': theme === 'dark',
  $notHashed: true
}}>
  Conditional classes
</div>`}</CodeBlock>
      
      <div 
        cx={{
          [css`background: #4ecdc4; color: white; padding: 12px; border-radius: 6px;`]: isActive,
          [css`background: #ff6b6b; color: white; padding: 12px; border-radius: 6px;`]: !isActive,
          [css`transform: scale(1.05);`]: isActive,
          $nonHashed: true
        }}
        onClick={() => setIsActive(!isActive)}
        style={{ cursor: 'pointer', margin: '12px 0', transition: 'all 0.3s ease' }}
      >
        Click to toggle active state (currently: {isActive ? 'active' : 'inactive'})
      </div>
    </DemoSection>
  );
}