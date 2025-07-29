import { css } from 'vindur';
import { DemoSection } from '../components/MainLayout';

const cardStyles = css`
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  padding: 20px;
  border-radius: 12px;
  margin: 16px 0;
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3);
  text-align: center;
  font-weight: 600;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 35px rgba(102, 126, 234, 0.4);
  }
`;

const textStyles = css`
  ---primaryColor: #250ce6;
  ---spacing: 12px;

  color: var(---primaryColor);
  margin: var(---spacing) 0;
  font-size: 18px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;

export function CssTaggedTemplateDemo() {
  return (
    <DemoSection title="CSS Tagged Templates">
      <div className={cardStyles}>Static CSS processed at compile-time</div>

      <div className={textStyles}>
        Using scoped CSS variables (---primaryColor)
      </div>
    </DemoSection>
  );
}
