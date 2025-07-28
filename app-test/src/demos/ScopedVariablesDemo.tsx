import { DemoSection, CodeBlock } from '../components/MainLayout';

export function ScopedVariablesDemo() {
  return (
    <DemoSection title="6. Scoped CSS Variables">
      <CodeBlock>{`const styles = css\`
  ---primaryColor: #667eea;
  ---spacing: 16px;
  
  background: var(---primaryColor);
  padding: var(---spacing);
\`;`}</CodeBlock>
      
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
        This uses scoped CSS variables!
      </div>
      
      <div 
        css={`
          ---gradientStart: #667eea;
          ---gradientEnd: #764ba2;
          ---textColor: white;
          ---shadowColor: rgba(102, 126, 234, 0.3);
          
          background: linear-gradient(45deg, var(---gradientStart), var(---gradientEnd));
          color: var(---textColor);
          padding: 16px;
          border-radius: 8px;
          text-align: center;
          margin: 12px 0;
          box-shadow: 0 4px 15px var(---shadowColor);
        `}
      >
        Multiple scoped variables in gradients and shadows
      </div>
    </DemoSection>
  );
}