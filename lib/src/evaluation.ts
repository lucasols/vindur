import type { TernaryConditionValue, OutputQuasi } from './types';

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
  args: Record<string, string | number | boolean | undefined>,
): string {
  if (quasi.type === 'string') {
    return quasi.value;
  } else if (quasi.type === 'arg') {
    const argValue = args[quasi.name];
    return argValue !== undefined ? String(argValue) : '';
  } else if (quasi.type === 'template') {
    // Evaluate each part of the template and concatenate
    let result = '';
    for (const part of quasi.parts) {
      result += evaluateQuasi(part, args);
    }
    return result;
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