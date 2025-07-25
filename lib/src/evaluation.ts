import type { TernaryConditionValue, OutputQuasi } from './types';

export function evaluateOutput(
  output: OutputQuasi[],
  args: Record<string, string | number | boolean>,
): string {
  let result = '';

  for (const quasi of output) {
    if (quasi.type === 'string') {
      result += quasi.value;
    } else if (quasi.type === 'arg') {
      const argValue = args[quasi.name];
      result += argValue !== undefined ? String(argValue) : '';
    } else {
      // quasi.type === 'ternary'
      const conditionResult = evaluateCondition(quasi.condition, args);
      if (conditionResult) {
        result += evaluateQuasi(quasi.ifTrue, args);
      } else {
        result += evaluateQuasi(quasi.ifFalse, args);
      }
    }
  }

  return result;
}

export function evaluateCondition(
  condition: [
    TernaryConditionValue,
    '===' | '!==' | '>' | '<' | '>=' | '<=',
    TernaryConditionValue,
  ],
  args: Record<string, string | number | boolean>,
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
      return typeof leftValue === 'number' && typeof rightValue === 'number' && leftValue > rightValue;
    case '<':
      return typeof leftValue === 'number' && typeof rightValue === 'number' && leftValue < rightValue;
    case '>=':
      return typeof leftValue === 'number' && typeof rightValue === 'number' && leftValue >= rightValue;
    case '<=':
      return typeof leftValue === 'number' && typeof rightValue === 'number' && leftValue <= rightValue;
    default:
      return false;
  }
}

export function evaluateQuasi(
  quasi: OutputQuasi,
  args: Record<string, string | number | boolean>,
): string {
  if (quasi.type === 'string') {
    return quasi.value;
  } else if (quasi.type === 'arg') {
    const argValue = args[quasi.name];
    return argValue !== undefined ? String(argValue) : '';
  }
  
  // quasi.type === 'ternary'
  const conditionResult = evaluateCondition(quasi.condition, args);
  if (conditionResult) {
    return evaluateQuasi(quasi.ifTrue, args);
  } else {
    return evaluateQuasi(quasi.ifFalse, args);
  }
}