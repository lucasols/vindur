import { describe, expect, it } from 'vitest';
import { transform } from '../src/transform';
import { createFsMock } from './testUtils';

describe('Path Resolution', () => {
  describe('relative imports', () => {
    it('should resolve relative imports with ./', () => {
      const mockFS = createFsMock({
        'main.ts': `
          import { spacing } from './utils';
          import { css } from 'vindur';
          
          const button = css\`
            margin: \${spacing(2)};
          \`;
        `,
        'utils.ts': `
          import { vindurFn } from 'vindur';
          
          export const spacing = vindurFn((multiplier: number) => \`\${multiplier * 8}px\`);
        `,
      });

      const result = transform({
        fileAbsPath: 'main.ts',
        source: mockFS.readFile('main.ts'),
        fs: mockFS,
      });

      expect(result.css).toMatchInlineSnapshot(`
        ".v6jbliu-1 {
          margin: 16px;
        }"
      `);
    });

    it('should resolve relative imports with ../', () => {
      const mockFS = createFsMock({
        components: {
          'Button.ts': `
            import { spacing } from '../utils/styles';
            import { css } from 'vindur';
            
            const button = css\`
              padding: \${spacing(1)};
            \`;
          `,
        },
        utils: {
          'styles.ts': `
            import { vindurFn } from 'vindur';
            
            export const spacing = vindurFn((multiplier: number) => \`\${multiplier * 4}px\`);
          `,
        },
      });

      const result = transform({
        fileAbsPath: 'components/Button.ts',
        source: mockFS.readFile('components/Button.ts'),
        fs: mockFS,
      });

      expect(result.css).toMatchInlineSnapshot(`
        ".v1vw6kc1-1 {
          padding: 4px;
        }"
      `);
    });

    it('should handle nested relative imports', () => {
      const mockFS = createFsMock({
        pages: {
          'Home.ts': `
            import { buttonStyles } from '../components/Button';
            import { css } from 'vindur';
            
            const home = css\`
              \${buttonStyles()};
              background: white;
            \`;
          `,
        },
        components: {
          'Button.ts': `
            import { vindurFn } from 'vindur';
            
            export const buttonStyles = vindurFn(() => \`
              padding: 16px;
              border-radius: 4px;
            \`);
          `,
        },
        utils: {
          'styles.ts': `
            import { vindurFn } from 'vindur';
            
            export const spacing = vindurFn((multiplier: number) => \`\${multiplier * 8}px\`);
          `,
        },
      });

      const result = transform({
        fileAbsPath: 'pages/Home.ts',
        source: mockFS.readFile('pages/Home.ts'),
        fs: mockFS,
      });

      expect(result.css).toMatchInlineSnapshot(`
        ".vqcvxt5-1 {
          padding: 16px;
            border-radius: 4px;
            background: white;
        }"
      `);
    });
  });

  describe('alias imports', () => {
    it('should resolve alias imports using importAliases option', () => {
      const mockFS = createFsMock({
        'main.ts': `
          import { spacing } from '@utils/styles';
          import { css } from 'vindur';
          
          const button = css\`
            margin: \${spacing(3)};
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

      const result = transform({
        fileAbsPath: 'main.ts',
        source: mockFS.readFile('main.ts'),
        fs: mockFS,
        importAliases: { '@utils': 'src/utils' },
      });

      expect(result.css).toMatchInlineSnapshot(`
        ".v6jbliu-1 {
          margin: 24px;
        }"
      `);
    });

    it('should resolve multiple alias imports', () => {
      const mockFS = createFsMock({
        'main.ts': `
          import { spacing } from '@utils/spacing';
          import { colors } from '@theme/colors';
          import { css } from 'vindur';
          
          const button = css\`
            margin: \${spacing(2)};
            color: \${colors('primary')};
          \`;
        `,
        lib: {
          utils: {
            'spacing.ts': `
              import { vindurFn } from 'vindur';
              
              export const spacing = vindurFn((multiplier: number) => \`\${multiplier * 4}px\`);
            `,
          },
        },
        design: {
          theme: {
            'colors.ts': `
              import { vindurFn } from 'vindur';
              
              export const colors = vindurFn((color: string) => \`#007bff\`);
            `,
          },
        },
      });

      const result = transform({
        fileAbsPath: 'main.ts',
        source: mockFS.readFile('main.ts'),
        fs: mockFS,
        importAliases: { '@utils': 'lib/utils', '@theme': 'design/theme' },
      });

      expect(result.css).toMatchInlineSnapshot(`
        ".v6jbliu-1 {
          margin: 8px;
          color: #007bff;
        }"
      `);
    });

    it('should prioritize aliases over relative paths', () => {
      const mockFS = createFsMock({
        'main.ts': `
          import { spacing } from '@utils/spacing';
          import { css } from 'vindur';
          
          const button = css\`
            margin: \${spacing(1)};
          \`;
        `,
        utils: {
          'spacing.ts': `
            import { vindurFn } from 'vindur';
            
            export const spacing = vindurFn((multiplier: number) => \`\${multiplier * 2}px\`);
          `,
        },
        lib: {
          utils: {
            'spacing.ts': `
              import { vindurFn } from 'vindur';
              
              export const spacing = vindurFn((multiplier: number) => \`\${multiplier * 16}px\`);
            `,
          },
        },
      });

      const result = transform({
        fileAbsPath: 'main.ts',
        source: mockFS.readFile('main.ts'),
        fs: mockFS,
        importAliases: { '@utils': 'lib/utils' },
      });

      expect(result.css).toMatchInlineSnapshot(`
        ".v6jbliu-1 {
          margin: 16px;
        }"
      `);
    });

    it('should handle nested alias imports', () => {
      const mockFS = createFsMock({
        'main.ts': `
          import { theme } from '@components/Theme';
          import { css } from 'vindur';
          
          const button = css\`
            \${theme('button')};
          \`;
        `,
        src: {
          components: {
            'Theme.ts': `
              import { vindurFn } from 'vindur';
              
              export const theme = vindurFn((component: string) => \`
                padding: 16px;
                border: 1px solid #ccc;
              \`);
            `,
          },
          utils: {
            'spacing.ts': `
              import { vindurFn } from 'vindur';
              
              export const spacing = vindurFn((multiplier: number) => \`\${multiplier * 8}px\`);
            `,
          },
        },
      });

      const result = transform({
        fileAbsPath: 'main.ts',
        source: mockFS.readFile('main.ts'),
        fs: mockFS,
        importAliases: {
          '@components': 'src/components',
          '@utils': 'src/utils',
        },
      });

      expect(result.css).toMatchInlineSnapshot(`
        ".v6jbliu-1 {
          padding: 16px;
                border: 1px solid #ccc;
        }"
      `);
    });
  });

  describe('mixed imports', () => {
    it('should handle both relative and alias imports in the same file', () => {
      const mockFS = createFsMock({
        components: {
          'Button.ts': `
            import { spacing } from './spacing';
            import { colors } from '@theme/colors';
            import { css } from 'vindur';
            
            const button = css\`
              padding: \${spacing(2)};
              background: \${colors('primary')};
            \`;
          `,
          'spacing.ts': `
            import { vindurFn } from 'vindur';
            
            export const spacing = vindurFn((multiplier: number) => \`\${multiplier * 4}px\`);
          `,
        },
        design: {
          theme: {
            'colors.ts': `
              import { vindurFn } from 'vindur';
              
              export const colors = vindurFn((color: string) => \`#ff6b6b\`);
            `,
          },
        },
      });

      const result = transform({
        fileAbsPath: 'components/Button.ts',
        source: mockFS.readFile('components/Button.ts'),
        fs: mockFS,
        importAliases: { '@theme': 'design/theme' },
      });

      expect(result.css).toMatchInlineSnapshot(`
        ".v1vw6kc1-1 {
          padding: 8px;
          background: #ff6b6b;
        }"
      `);
    });
  });

  describe('error handling', () => {
    it('should throw error when alias is not found', () => {
      const mockFS = createFsMock({
        'main.ts': `
          import { spacing } from '@utils/spacing';
          import { css } from 'vindur';
          
          const button = css\`
            margin: \${spacing(1)};
          \`;
        `,
      });

      expect(() => {
        transform({
          fileAbsPath: 'main.ts',
          source: mockFS.readFile('main.ts'),
          fs: mockFS,
          importAliases: { '@theme': 'design/theme' },
        });
      }).toThrow();
    });

    it('should throw error when relative import file does not exist', () => {
      const mockFS = createFsMock({
        'main.ts': `
          import { spacing } from './utils';
          import { css } from 'vindur';
          
          const button = css\`
            margin: \${spacing(1)};
          \`;
        `,
      });

      expect(() => {
        transform({
          fileAbsPath: 'main.ts',
          source: mockFS.readFile('main.ts'),
          fs: mockFS,
        });
      }).toThrow();
    });
  });
});
