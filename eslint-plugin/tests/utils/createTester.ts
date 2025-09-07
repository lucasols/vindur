import { compactSnapshot } from '@ls-stack/utils/testUtils';
import * as tsParser from '@typescript-eslint/parser';
import type { Rule } from 'eslint';
import {
  createRuleTester,
  type TestExecutionResult,
} from 'eslint-vitest-rule-tester';

export function getErrorsFromResult(result: TestExecutionResult) {
  return compactSnapshot(
    result.messages.map((m) => ({
      messageId: m.messageId,
      data: m.message,
    })),
  );
}

export function getErrorsWithMsgFromResult(result: TestExecutionResult) {
  return compactSnapshot(
    result.messages.map((m) => {
      let loc = `${m.line}:${m.column}`;

      if (m.endLine && m.endColumn) {
        loc += `->${m.endLine}:${m.endColumn}`;
      }

      return {
        messageId: m.messageId,
        msg: m.message,
        loc,
      };
    }),
  );
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
