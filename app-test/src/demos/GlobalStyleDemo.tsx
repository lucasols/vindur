import { createGlobalStyle, styled } from 'vindur';
import { DemoSection } from '../components/MainLayout';

// Global styles for demo-specific elements
createGlobalStyle`
  .demo-global-card {
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    padding: 16px;
    border-radius: 12px;
    margin: 8px 0;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
    transition: transform 0.2s ease;
  }

  .demo-global-card:hover {
    transform: translateY(-2px);
  }

  .demo-global-text {
    font-size: 18px;
    font-weight: 600;
    text-align: center;
  }

  .demo-global-highlight {
    background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
    padding: 4px 8px;
    border-radius: 4px;
    color: white;
    font-weight: bold;
  }
`;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;


const CodeExample = styled.pre`
  background: rgba(0, 0, 0, 0.3);
  color: #a8e6cf;
  padding: 12px;
  border-radius: 6px;
  font-size: 12px;
  overflow-x: auto;
  margin: 8px 0;
`;

export function GlobalStyleDemo() {
  return (
    <DemoSection title="Global Styles">
      <Container>

        <CodeExample>
{`createGlobalStyle\`
  .demo-global-card {
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    padding: 16px;
    border-radius: 12px;
    /* ... */
  }
\`;`}
        </CodeExample>

        <div className="demo-global-card">
          <div className="demo-global-text">
            This card uses global styles from{' '}
            <span className="demo-global-highlight">createGlobalStyle</span>
          </div>
        </div>

        <div className="demo-global-card">
          <div className="demo-global-text">
            All elements with <code>.demo-global-card</code> class share the same styles
          </div>
        </div>

      </Container>
    </DemoSection>
  );
}