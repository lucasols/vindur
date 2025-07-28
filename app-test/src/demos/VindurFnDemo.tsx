import { vindurFn } from 'vindur';
import { DemoSection, CodeBlock } from '../components/MainLayout';

const spacing = vindurFn((size: number) => `
  margin: ${size * 8}px;
  padding: ${size * 4}px;
`);

const colorBox = vindurFn((color: string, size: number) => `
  background: ${color};
  width: ${size}px;
  height: ${size}px;
  border-radius: 8px;
  display: inline-block;
  margin: 8px;
  border: 2px solid white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
`);

export function VindurFnDemo() {
  return (
    <DemoSection title="5. VindurFn Utilities">
      <CodeBlock>{`const buttonStyles = vindurFn((variant) => \`
  padding: 12px 24px;
  background: \${variant === 'primary' ? 'blue' : 'gray'};
\`);

const spacing = vindurFn((size) => \`
  margin: \${size * 8}px;
\`);`}</CodeBlock>
      
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div className={spacing(2)} style={{ background: 'rgba(255,255,255,0.2)', borderRadius: '4px', color: 'white', padding: '8px' }}>
          Spacing utility (size: 2)
        </div>
        <div className={spacing(4)} style={{ background: 'rgba(255,255,255,0.2)', borderRadius: '4px', color: 'white', padding: '8px' }}>
          Spacing utility (size: 4)
        </div>
      </div>
      
      <div style={{ marginTop: '16px' }}>
        <div className={colorBox('#ff6b6b', 40)}></div>
        <div className={colorBox('#4ecdc4', 60)}></div>
        <div className={colorBox('#45b7d1', 50)}></div>
        <div className={colorBox('#f9ca24', 55)}></div>
      </div>
    </DemoSection>
  );
}