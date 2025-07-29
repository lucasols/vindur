import { styled } from 'vindur';
import { DemoSection } from '../components/MainLayout';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;


// Styled component that supports css prop
const CustomCard = styled.div`
  padding: 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: white;
`;

export function CssPropDemo() {
  return (
    <DemoSection title="CSS Prop">
      <Container>

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
            transition: transform 0.2s ease;

            &:hover {
              transform: scale(1.02);
            }
          `}
        >
          CSS prop on native div element
        </div>

        <div
          css={`
            ---cardColor: #4ecdc4;
            ---cardPadding: 20px;
            
            padding: var(---cardPadding);
            background: var(---cardColor);
            color: white;
            border-radius: 12px;
            text-align: center;
            font-weight: 600;
            box-shadow: 0 6px 20px rgba(76, 205, 196, 0.4);
          `}
        >
          CSS prop with scoped variables
        </div>

        <CustomCard
          css={`
            background: linear-gradient(135deg, #667eea, #764ba2);
            transform: rotate(-1deg);
            box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3);
            
            &:hover {
              transform: rotate(0deg) scale(1.05);
            }
          `}
        >
          CSS prop on styled component
        </CustomCard>

        <section
          css={`
            padding: 16px;
            background: rgba(255, 255, 255, 0.05);
            border-left: 4px solid #ff6b6b;
            border-radius: 4px;
          `}
        >
          <h4
            css={`
              margin: 0 0 8px 0;
              color: #ff6b6b;
              font-size: 16px;
            `}
          >
            Multiple Elements
          </h4>
          <p
            css={`
              margin: 0;
              color: white;
              line-height: 1.5;
            `}
          >
            Each element can have its own css prop with unique styles.
          </p>
        </section>
      </Container>
    </DemoSection>
  );
}
