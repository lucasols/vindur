import { types as t } from '@babel/core';
import type { OutputQuasi } from './types';
import { parseConditionValue } from './function-parser-ternary';

export function parseBinaryExpression(
  expr: t.BinaryExpression,
  functionName: string,
  validParameterNames?: Set<string>,
): OutputQuasi | null {
  const { left, right, operator } = expr;

  // Only support basic arithmetic operators
  if (!['+', '-', '*', '/'].includes(operator)) return null;

  // Ensure operands are expressions
  if (!t.isExpression(left) || !t.isExpression(right)) {
    return null;
  }

  // Parse left operand
  const leftValue = parseConditionValue(
    left,
    functionName,
    validParameterNames,
  );

  // Parse right operand
  const rightValue = parseConditionValue(
    right,
    functionName,
    validParameterNames,
  );

  if (
    operator !== '+'
    && operator !== '-'
    && operator !== '*'
    && operator !== '/'
  ) {
    return null;
  }

  return {
    type: 'binary',
    operator,
    left: leftValue,
    right: rightValue,
  };
}