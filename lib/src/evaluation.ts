import { types as t } from '@babel/core';
import type { OutputQuasi, TernaryConditionValue } from './types';
import { TransformError } from './custom-errors';

export function evaluateOutput(
  output: OutputQuasi[],
  args: Record<string, string | number | boolean | undefined>,
  callLoc?: t.SourceLocation | null,
): string {
  let result = '';

  for (const quasi of output) {
    result += evaluateQuasi(quasi, args, callLoc);
  }

  return result;
}

export function evaluateCondition(
  condition: [
    TernaryConditionValue,
    '===' | '!==' | '>' | '<' | '>=' | '<=',
    TernaryConditionValue,
  ],
  args: Record<string, string | number | boolean | undefined>,
): boolean {
  const [left, operator, right] = condition;

  const leftValue = left.type === 'arg' ? args[left.name] : left.value;
  const rightValue = right.type === 'arg' ? args[right.name] : right.value;

  switch (operator) {
    case '===':
      return leftValue === rightValue;
    case '!==':
      return leftValue !== rightValue;
    case '>':
      return (
        typeof leftValue === 'number'
        && typeof rightValue === 'number'
        && leftValue > rightValue
      );
    case '<':
      return (
        typeof leftValue === 'number'
        && typeof rightValue === 'number'
        && leftValue < rightValue
      );
    case '>=':
      return (
        typeof leftValue === 'number'
        && typeof rightValue === 'number'
        && leftValue >= rightValue
      );
    case '<=':
      return (
        typeof leftValue === 'number'
        && typeof rightValue === 'number'
        && leftValue <= rightValue
      );
    default:
      return false;
  }
}

export function evaluateQuasi(
  quasi: OutputQuasi,
  args: Record<string, string | number | boolean | undefined>,
  callLoc?: t.SourceLocation | null,
): string {
  if (quasi.type === 'string') {
    return quasi.value;
  } else if (quasi.type === 'arg') {
    const argValue = args[quasi.name];
    if (argValue === undefined) {
      throw new TransformError(
        `Argument '${quasi.name}' is undefined`,
        callLoc,
      );
    }
    return String(argValue);
  } else if (quasi.type === 'template') {
    // Evaluate each part of the template and concatenate
    let result = '';
    for (const part of quasi.parts) {
      result += evaluateQuasi(part, args, callLoc);
    }
    return result;
  } else if (quasi.type === 'binary') {
    // Handle binary expressions like `multiplier * 8`
    const leftValue =
      quasi.left.type === 'arg' ? args[quasi.left.name] : quasi.left.value;
    const rightValue =
      quasi.right.type === 'arg' ? args[quasi.right.name] : quasi.right.value;

    // Check if left value is undefined
    if (leftValue === undefined) {
      const leftName = quasi.left.type === 'arg' ? quasi.left.name : 'literal';
      throw new TransformError(
        `Binary expression evaluation failed: left operand '${leftName}' is undefined`,
        null,
      );
    }

    // Check if right value is undefined
    if (rightValue === undefined) {
      const rightName =
        quasi.right.type === 'arg' ? quasi.right.name : 'literal';
      throw new TransformError(
        `Binary expression evaluation failed: right operand '${rightName}' is undefined`,
        null,
      );
    }

    // Check if both values are numbers
    if (typeof leftValue !== 'number' || typeof rightValue !== 'number') {
      throw new TransformError(
        `Binary expression evaluation failed: operands must be numbers`,
        null,
      );
    }

    let result: number;
    switch (quasi.operator) {
      case '+':
        result = leftValue + rightValue;
        break;
      case '-':
        result = leftValue - rightValue;
        break;
      case '*':
        result = leftValue * rightValue;
        break;
      case '/':
        if (rightValue === 0) {
          throw new TransformError(
            `Binary expression evaluation failed: division by zero`,
            null,
          );
        }
        result = leftValue / rightValue;
        break;
      default:
        throw new TransformError(
          `Binary expression evaluation failed: unsupported operator '${String(quasi.operator)}'`,
          null,
        );
    }
    return result.toString();
  } else {
    // quasi.type === 'ternary'
    const conditionResult = evaluateCondition(quasi.condition, args);
    if (conditionResult) {
      return evaluateQuasi(quasi.ifTrue, args, callLoc);
    } else {
      return evaluateQuasi(quasi.ifFalse, args, callLoc);
    }
  }
}
