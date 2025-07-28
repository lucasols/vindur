import type { ReactNode } from 'react';
import { css, styled } from 'vindur';

const containerStyles = css`
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;

  ---primaryColor: #667eea;
  ---secondaryColor: #764ba2;
  ---textColor: white;
`;

export const Card = styled.div`
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 16px;
  padding: 24px;
  margin: 16px 0;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);

  ---cardBackground: rgba(255, 255, 255, 0.95);
  ---cardPadding: 24px;
  ---cardRadius: 16px;
`;

export const Title = styled.h1`
  background: linear-gradient(45deg, #667eea, #764ba2);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: 2.5rem;
  margin: 0 0 12px 0;
  text-align: center;
`;

export const Subtitle = styled.h2`
  color: #666;
  font-size: 1.2rem;
  font-weight: 400;
  margin: 0 0 32px 0;
  text-align: center;
`;

const FeatureSection = styled.section`
  margin: 32px 0;
  padding: 24px;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.1),
    rgba(255, 255, 255, 0.05)
  );
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
`;

const FeatureTitle = styled.h3`
  color: white;
  margin: 0 0 16px 0;
  font-size: 1.4rem;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
`;

export const CodeBlock = styled.pre`
  background: rgba(0, 0, 0, 0.8);
  color: #00ff88;
  padding: 16px;
  border-radius: 8px;
  margin: 12px 0;
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 14px;
  overflow-x: auto;
  border: 1px solid rgba(0, 255, 136, 0.2);
`;

type MainLayoutProps = {
  children: ReactNode;
};

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className={containerStyles}>
      <Card>
        <Title>Vindur CSS-in-JS Demo</Title>
        <Subtitle>Complete showcase of all features</Subtitle>
      </Card>
      {children}
    </div>
  );
}

type DemoSectionProps = {
  title: string;
  children: ReactNode;
};

export function DemoSection({ title, children }: DemoSectionProps) {
  return (
    <FeatureSection>
      <FeatureTitle>{title}</FeatureTitle>
      {children}
    </FeatureSection>
  );
}
