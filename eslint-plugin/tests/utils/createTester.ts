import type { Rule } from 'eslint';
import {
  createRuleTester,
  type TestExecutionResult,
} from 'eslint-vitest-rule-tester';
import * as tsParser from '@typescript-eslint/parser';

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
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  });
}
