import js from '@eslint/js';
import { extendedLintPlugin } from '@ls-stack/extended-lint';
import eslintUnicornPlugin from 'eslint-plugin-unicorn';
import vitest from 'eslint-plugin-vitest';
import tseslint from 'typescript-eslint';

const isCI = process.env.CI === 'true';

export const OFF = 0;
export const WARN = 1;
export const ERROR = 2;
export const ERROR_IN_CI = isCI ? ERROR : WARN;
export const ERROR_IN_CI_ONLY = isCI ? ERROR : 0;

type RuleLevel = 0 | 1 | 2;
type RuleEntry = RuleLevel | [RuleLevel, ...unknown[]];

export function createBaseConfig({
  globalRules = {},
  extraRuleGroups,
  extraIgnorePatterns,
}: {
  globalRules?: Record<string, RuleEntry>;
  extraRuleGroups?: {
    plugins?: Record<string, any>;
    files: string[];
    rules: Record<string, RuleEntry>;
  }[];
  extraIgnorePatterns?: string[];
} = {}) {
  return tseslint.config(
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      linterOptions: { reportUnusedDisableDirectives: true },
      languageOptions: {
        parserOptions: {
          project: './tsconfig.json',
          tsconfigRootDir: import.meta.dirname,
        },
        globals: { process: true },
      },
    },
    {
      plugins: {
        '@ls-stack': extendedLintPlugin,
        unicorn: eslintUnicornPlugin,
        vitest,
      },
      rules: {
        'no-warning-comments': [ERROR_IN_CI, { terms: ['FIX:'] }],
        'no-constant-binary-expression': ERROR_IN_CI,
        'object-shorthand': ERROR_IN_CI,
        'no-useless-rename': ERROR_IN_CI,
        'no-param-reassign': ERROR_IN_CI,
        'prefer-template': ERROR_IN_CI,
        'prefer-const': [ERROR_IN_CI, { destructuring: 'all' }],

        'no-prototype-builtins': OFF,
        'no-inner-declarations': OFF,
        'no-undef': OFF,
        'no-console': [ERROR_IN_CI, { allow: ['warn', 'error', 'info'] }],
        'no-restricted-imports': [
          ERROR_IN_CI,
          {
            patterns: [
              { group: ['*.test'], message: 'Do not import test files' },
              { group: ['dist-old', 'dist'], message: 'Only import from src' },
            ],
          },
        ],
        'no-restricted-syntax': [
          ERROR_IN_CI_ONLY,
          {
            selector: 'CallExpression[callee.property.name="only"]',
            message: 'No test.only',
          },
          {
            selector: 'CallExpression[callee.property.name="todo"]',
            message: 'No test.todo',
          },
        ],
        'no-implicit-coercion': [
          ERROR_IN_CI,
          { disallowTemplateShorthand: true, allow: ['!!'] },
        ],
        'max-lines': [
          ERROR,
          { max: 500, skipBlankLines: true, skipComments: true },
        ],
        complexity: [ERROR, { max: 30 }],

        /* typescript */
        '@typescript-eslint/no-unnecessary-condition': ERROR,
        '@typescript-eslint/naming-convention': [
          'error',
          { selector: 'typeLike', format: ['PascalCase'] },
        ],
        '@typescript-eslint/only-throw-error': ERROR_IN_CI,
        '@typescript-eslint/no-unused-expressions': ERROR_IN_CI,
        '@typescript-eslint/no-unused-vars': [
          ERROR_IN_CI,
          {
            argsIgnorePattern: '^_',
            ignoreRestSiblings: true,
            varsIgnorePattern: '^_',
          },
        ],
        '@typescript-eslint/no-shadow': [
          ERROR_IN_CI,
          { ignoreOnInitialization: true, allow: ['expect'] },
        ],

        '@typescript-eslint/no-floating-promises': OFF,
        '@typescript-eslint/no-unsafe-call': ERROR_IN_CI,
        '@typescript-eslint/no-explicit-any': ERROR,
        '@typescript-eslint/no-unsafe-member-access': ERROR_IN_CI,
        '@typescript-eslint/no-unsafe-argument': ERROR_IN_CI,
        '@typescript-eslint/ban-ts-comment': ERROR,
        '@typescript-eslint/prefer-optional-chain': ERROR,
        '@typescript-eslint/no-non-null-assertion': ERROR,
        '@typescript-eslint/consistent-type-assertions': [
          ERROR,
          { assertionStyle: 'never' },
        ],
        '@typescript-eslint/no-deprecated': ERROR,

        /* vitest */
        'vitest/expect-expect': ERROR_IN_CI,
        'vitest/no-identical-title': ERROR_IN_CI,

        /* extended-lint */
        '@ls-stack/no-unused-type-props-in-args': ERROR,
        '@ls-stack/improved-no-unnecessary-condition': ERROR,
        '@ls-stack/no-optional-root-props': ERROR_IN_CI,
        '@ls-stack/prefer-single-line-if': [
          WARN,
          { maxLineLength: 80, maxNonSimpleConditionLength: 40 },
        ],
        '@ls-stack/prefer-named-functions': [WARN, { ignoreRegex: 'Fn$' }],
        '@ls-stack/require-description': [ERROR, { ignore: ['eslint'] }],
        '@ls-stack/no-default-export': ERROR,
        '@ls-stack/no-unnecessary-casting': [
          ERROR_IN_CI,
          {
            additionalCastFunctions: [
              { name: 'castToString', expectedType: 'string' },
              { name: 'castToNumber', expectedType: 'number' },
            ],
          },
        ],
        '@ls-stack/no-type-guards': [
          ERROR,
          {
            alternativeMsgs: {
              inArrayFilter: 'Use filterWithNarrowing instead',
              inArrayFind: 'Use findWithNarrowing instead',
            },
          },
        ],
        '@ls-stack/use-top-level-regex': ERROR,

        // eslint unicorn rules
        'unicorn/expiring-todo-comments': [
          ERROR_IN_CI,
          {
            terms: [
              'FIX',
              'palinter-ignore-unused-next-line',
              'palinter-ignore-not-have-direct-circular-deps',
              'palinter-ignore-not-have-circular-deps',
              'palinter-ignore-not-have-unused-exports',
            ],
            ignore: [/^ HACK:/, /^ TODO:/],
            allowWarningComments: false,
          },
        ],
        'unicorn/require-array-join-separator': ERROR,
        'unicorn/no-empty-file': ERROR,
        'unicorn/no-array-reduce': [ERROR, { allowSimpleOperations: true }],
        'unicorn/no-array-for-each': ERROR,
        'unicorn/template-indent': [WARN, { tags: ['dedent'] }],
        ...globalRules,
      },
    },
    {
      files: ['**/*.test.ts'],
      rules: {
        'max-lines': [
          ERROR,
          { max: 700, skipBlankLines: true, skipComments: true },
        ],
      },
    },
    {
      files: [
        '**/eslint.config.ts',
        '**/vitest.config.ts',
        '**/tsup.config.ts',
      ],
      rules: {
        '@ls-stack/no-default-export': OFF,
      },
    },
    ...(extraRuleGroups || []),
    {
      ignores: [
        'dist/**',
        'build/**',
        'node_modules/**',
        ...(extraIgnorePatterns || []),
      ],
    },
  );
}
