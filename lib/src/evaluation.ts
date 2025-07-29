import type { OutputQuasi, TernaryConditionValue } from './types';

export function evaluateOutput(
  output: OutputQuasi[],
  args: Record<string, string | number | boolean | undefined>,
): string {
  let result = '';

  for (const quasi of output) {
    result += evaluateQuasi(quasi, args);
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
): string {
  if (quasi.type === 'string') {
    return quasi.value;
  } else if (quasi.type === 'arg') {
    const argValue = args[quasi.name];
    if (argValue === undefined) {
      throw new Error(`Argument '${quasi.name}' is undefined`);
    }
    return String(argValue);
  } else if (quasi.type === 'template') {
    // Evaluate each part of the template and concatenate
    let result = '';
    for (const part of quasi.parts) {
      result += evaluateQuasi(part, args);
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
      throw new Error(
        `Binary expression evaluation failed: left operand '${leftName}' is undefined`,
      );
    }

    // Check if right value is undefined
    if (rightValue === undefined) {
      const rightName =
        quasi.right.type === 'arg' ? quasi.right.name : 'literal';
      throw new Error(
        `Binary expression evaluation failed: right operand '${rightName}' is undefined`,
      );
    }

    // Check if both values are numbers
    if (typeof leftValue !== 'number' || typeof rightValue !== 'number') {
      throw new Error(
        `Binary expression evaluation failed: operands must be numbers`,
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
          throw new Error(
            `Binary expression evaluation failed: division by zero`,
          );
        }
        result = leftValue / rightValue;
        break;
      default:
        throw new Error(
          `Binary expression evaluation failed: unsupported operator '${String(quasi.operator)}'`,
        );
    }
    return result.toString();
  } else {
    // quasi.type === 'ternary'
    const conditionResult = evaluateCondition(quasi.condition, args);
    if (conditionResult) {
      return evaluateQuasi(quasi.ifTrue, args);
    } else {
      return evaluateQuasi(quasi.ifFalse, args);
    }
  }
}
