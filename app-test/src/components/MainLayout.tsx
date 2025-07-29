import type { ReactNode } from 'react';
import { styled } from 'vindur';
import { Sidebar } from './Sidebar';

const Layout = styled.div`
  display: flex;
  min-height: 100vh;
`;

const MainContent = styled.main`
  flex: 1;
  margin-left: 250px;
  padding: 40px;
  width: calc(100vw - 250px);
  min-height: 100vh;
`;

const Section = styled.section`
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 30px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
`;

const SectionTitle = styled.h1`
  color: white;
  font-size: 32px;
  font-weight: 600;
  margin: 0 0 30px 0;
  border-bottom: 2px solid rgba(255, 255, 255, 0.2);
  padding-bottom: 15px;
`;

type MainLayoutProps = {
  children: ReactNode;
};

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <Layout>
      <Sidebar />
      <MainContent>
        {children}
      </MainContent>
    </Layout>
  );
}

type DemoSectionProps = {
  title: string;
  children: ReactNode;
};

export function DemoSection({ title, children }: DemoSectionProps) {
  return (
    <Section>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </Section>
  );
}
