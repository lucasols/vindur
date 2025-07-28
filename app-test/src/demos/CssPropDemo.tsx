import { DemoSection } from '../components/MainLayout';

export function CssPropDemo() {
  return (
    <DemoSection title="3. CSS Prop">
      <div
        css={`
          padding: 16px;
          background: linear-gradient(45deg, #f093fb, #f5576c);
          color: white;
          border-radius: 8px;
          text-align: center;
          font-weight: 600;
          margin: 12px 0;
          box-shadow: 0 4px 15px rgba(240, 147, 251, 0.3);
        `}
      >
        This div uses the css prop!
      </div>
    </DemoSection>
  );
}
