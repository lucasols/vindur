import { describe, expect, it } from 'vitest';
import { transform } from '../../src/transform';
import { createFsMock } from '../testUtils';

describe('Path Resolution', () => {
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
        fileAbsPath: '/main.ts',
        source: mockFS.readFile('/main.ts'),
        fs: mockFS,
        importAliases: { '@utils': '/src/utils' },
      });

      expect(result.css).toMatchInlineSnapshot(`
        ".v1mq0rjp-1 {
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
        fileAbsPath: '/main.ts',
        source: mockFS.readFile('/main.ts'),
        fs: mockFS,
        importAliases: { '@utils': '/lib/utils', '@theme': '/design/theme' },
      });

      expect(result.css).toMatchInlineSnapshot(`
        ".v1mq0rjp-1 {
          margin: 8px;
                    color: #007bff;
        }"
      `);
    });

    it('should prioritize aliases over non-alias imports', () => {
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
        fileAbsPath: '/main.ts',
        source: mockFS.readFile('/main.ts'),
        fs: mockFS,
        importAliases: { '@utils': '/lib/utils' },
      });

      expect(result.css).toMatchInlineSnapshot(`
        ".v1mq0rjp-1 {
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
        fileAbsPath: '/main.ts',
        source: mockFS.readFile('/main.ts'),
        fs: mockFS,
        importAliases: {
          '@components': '/src/components',
          '@utils': '/src/utils',
        },
      });

      expect(result.css).toMatchInlineSnapshot(`
        ".v1mq0rjp-1 {
          padding: 16px;
                        border: 1px solid #ccc;
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
          fileAbsPath: '/main.ts',
          source: mockFS.readFile('/main.ts'),
          fs: mockFS,
          importAliases: { '@theme': '/design/theme' },
        });
      }).toThrowErrorMatchingInlineSnapshot(`
        [TransformError: /main.ts: Unresolved function call at \`... button = css\` ... \${spacing(1)}, function must be statically analyzable and correctly imported with the configured aliases
        loc: 6:22]
      `);
    });
  });
});
