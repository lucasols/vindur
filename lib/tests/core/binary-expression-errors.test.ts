import { describe, expect, it } from 'vitest';
import { transform } from '../../src/transform';
import { createFsMock } from '../testUtils';

describe('Binary Expression Error Handling', () => {
  it('should throw error when binary expression argument is undefined', () => {
    const mockFS = createFsMock({
      'main.ts': `
        import { spacing } from '@utils/styles';
        import { css } from 'vindur';
        
        const button = css\`
          margin: \${spacing()};
        \`;
      `,
      src: {
        utils: {
          'styles.ts': `
            import { vindurFn } from 'vindur';
            
            export const spacing = vindurFn((multiplier: number) => \`\${multiplier * 8}px\`);
          `,
        },
      },
    });

    expect(() => {
      transform({
        fileAbsPath: '/main.ts',
        source: mockFS.readFile('/main.ts'),
        fs: mockFS,
        importAliases: { '@utils': '/src/utils' },
      });
    }).toThrow(
      "Binary expression evaluation failed: left operand 'multiplier' is undefined",
    );
  });

  it('should throw error when binary expression operand is not a number', () => {
    const mockFS = createFsMock({
      'main.ts': `
        import { spacing } from '@utils/styles';
        import { css } from 'vindur';
        
        const button = css\`
          margin: \${spacing('invalid')};
        \`;
      `,
      src: {
        utils: {
          'styles.ts': `
            import { vindurFn } from 'vindur';
            
            export const spacing = vindurFn((multiplier: number) => \`\${multiplier * 8}px\`);
          `,
        },
      },
    });

    expect(() => {
      transform({
        fileAbsPath: '/main.ts',
        source: mockFS.readFile('/main.ts'),
        fs: mockFS,
        importAliases: { '@utils': '/src/utils' },
      });
    }).toThrow('Binary expression evaluation failed: operands must be numbers');
  });

  it('should throw error for division by zero', () => {
    const mockFS = createFsMock({
      'main.ts': `
        import { spacing } from '@utils/styles';
        import { css } from 'vindur';
        
        const button = css\`
          margin: \${spacing(10, 0)};
        \`;
      `,
      src: {
        utils: {
          'styles.ts': `
            import { vindurFn } from 'vindur';
            
            export const spacing = vindurFn((dividend: number, divisor: number) => \`\${dividend / divisor}px\`);
          `,
        },
      },
    });

    expect(() => {
      transform({
        fileAbsPath: '/main.ts',
        source: mockFS.readFile('/main.ts'),
        fs: mockFS,
        importAliases: { '@utils': '/src/utils' },
      });
    }).toThrow('Binary expression evaluation failed: division by zero');
  });
});
