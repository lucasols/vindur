import { dedent } from '@ls-stack/utils/dedent';
import {
  createRuleTester,
  type TestExecutionResult,
} from 'eslint-vitest-rule-tester';
import type { Rule } from 'eslint';

export function getErrorsFromResult(
  result: TestExecutionResult,
  include: {
    msg?: boolean;
    column?: boolean;
    endLine?: boolean;
    endColumn?: boolean;
  } = {},
) {
  return result.messages.map((m) => ({
    messageId: m.messageId,
    data: include.msg ? m.message : undefined,
    line: m.line,
    column: include.column ? m.column : undefined,
    endLine: include.endLine ? m.endLine : undefined,
    endColumn: include.endColumn ? m.endColumn : undefined,
  }));
}

export function getErrorsWithMsgFromResult(result: TestExecutionResult) {
  return result.messages.map((m) => ({
    messageId: m.messageId,
    msg: m.message,
    line: m.line,
  }));
}

export function createVindurTester(rule: {
  name: string;
  rule: Rule.RuleModule;
}) {
  return createRuleTester({
    name: rule.name,
    rule: rule.rule,
    configs: [{
      languageOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        parserOptions: {
          ecmaFeatures: {
            jsx: true,
          },
        },
      },
      linterOptions: {
        reportUnusedDisableDirectives: 'off',
      },
    }],
  });
}

export function createTestCase(
  code: string,
  {
    filename = '/test.ts',
    options,
  }: {
    filename?: string;
    options?: any[];
  } = {}
) {
  return {
    code: dedent(code),
    filename,
    options,
  };
}