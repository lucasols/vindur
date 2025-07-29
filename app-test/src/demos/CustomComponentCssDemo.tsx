import { css } from 'vindur';

const styles = css`
  background: lightblue;
  padding: 20px;
  border-radius: 8px;
`;

interface CustomCardProps {
  children: React.ReactNode;
  css?: string;
  className?: string;
}

const CustomCard = ({ children, css, className }: CustomCardProps) => {
  // Merge css and className props
  const finalClassName = [className, css].filter(Boolean).join(' ');
  
  return <div className={finalClassName}>{children}</div>;
};

export function CustomComponentCssDemo() {
  return (
    <div>
      <h2>Custom Component CSS Prop Demo</h2>
      
      <CustomCard css={`color: red; font-weight: bold;`}>
        Custom component with inline CSS
      </CustomCard>
      
      <CustomCard css={styles}>
        Custom component with CSS reference
      </CustomCard>
      
      <CustomCard className="base-class" css={`margin-top: 20px;`}>
        Custom component with both className and css
      </CustomCard>
    </div>
  );
}