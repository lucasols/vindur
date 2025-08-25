import { types as t } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import type { OutputQuasi, TernaryConditionValue } from './types';
import { TransformError } from './custom-errors';

export function evaluateOutput(
  output: OutputQuasi[],
  args: Record<
    string,
    string | number | boolean | (string | number)[] | undefined
  >,
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
    '===' | '!==' | '>' | '<' | '>=' | '<=' | 'isArray',
    TernaryConditionValue,
  ],
  args: Record<
    string,
    string | number | boolean | (string | number)[] | undefined
  >,
): boolean {
  const [left, operator, right] = condition;

  const leftValue =
    left.type === 'arg' ? args[left.name]
    : left.type === 'isArray' ? args[left.arg]
    : left.value;
  const rightValue =
    right.type === 'arg' ? args[right.name]
    : right.type === 'isArray' ? args[right.arg]
    : right.value;

  // Special case: handle truthiness checks (identifier === true)
  if (operator === '===' && right.type === 'boolean' && right.value === true) {
    // Convert to JavaScript truthiness check
    return !!leftValue;
  }

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
    case 'isArray':
      // Handle Array.isArray() condition
      if (left.type === 'isArray') {
        const argValue = args[left.arg];
        return Array.isArray(argValue);
      }
      return false;
    default:
      return false;
  }
}

export function evaluateQuasi(
  quasi: OutputQuasi,
  args: Record<
    string,
    string | number | boolean | (string | number)[] | undefined
  >,
  callLoc?: t.SourceLocation | null,
): string {
  if (quasi.type === 'string') {
    return quasi.value;
  } else if (quasi.type === 'arg') {
    return evaluateArgQuasi(quasi, args, callLoc);
  } else if (quasi.type === 'template') {
    return evaluateTemplateQuasi(quasi, args, callLoc);
  } else if (quasi.type === 'binary') {
    return evaluateBinaryQuasi(quasi, args, callLoc);
  } else if (quasi.type === 'arrayMethod') {
    return evaluateArrayMethodQuasi(quasi, args, callLoc);
  } else if (quasi.type === 'arrayMap') {
    return evaluateArrayMapQuasi(quasi, args, callLoc);
  } else if (quasi.type === 'mapJoin') {
    return evaluateMapJoinQuasi(quasi, args, callLoc);
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

function evaluateArgQuasi(
  quasi: { type: 'arg'; name: string },
  args: Record<
    string,
    string | number | boolean | (string | number)[] | undefined
  >,
  callLoc?: t.SourceLocation | null,
): string {
  const argValue = args[quasi.name];
  if (argValue === undefined) {
    throw new TransformError(
      `Argument '${quasi.name}' is undefined`,
      notNullish(callLoc),
    );
  }
  return String(argValue);
}

function evaluateTemplateQuasi(
  quasi: { type: 'template'; parts: OutputQuasi[] },
  args: Record<
    string,
    string | number | boolean | (string | number)[] | undefined
  >,
  callLoc?: t.SourceLocation | null,
): string {
  let result = '';
  for (const part of quasi.parts) {
    result += evaluateQuasi(part, args, callLoc);
  }
  return result;
}

function evaluateBinaryQuasi(
  quasi: {
    type: 'binary';
    left: TernaryConditionValue;
    operator: '+' | '-' | '*' | '/';
    right: TernaryConditionValue;
  },
  args: Record<
    string,
    string | number | boolean | (string | number)[] | undefined
  >,
  callLoc?: t.SourceLocation | null,
): string {
  const leftValue =
    quasi.left.type === 'arg' ? args[quasi.left.name]
    : quasi.left.type === 'isArray' ? args[quasi.left.arg]
    : quasi.left.value;
  const rightValue =
    quasi.right.type === 'arg' ? args[quasi.right.name]
    : quasi.right.type === 'isArray' ? args[quasi.right.arg]
    : quasi.right.value;

  // Check if left value is undefined
  if (leftValue === undefined) {
    const leftName = quasi.left.type === 'arg' ? quasi.left.name : 'literal';
    throw new TransformError(
      `Binary expression evaluation failed: left operand '${leftName}' is undefined`,
      notNullish(callLoc),
    );
  }

  // Check if right value is undefined
  if (rightValue === undefined) {
    const rightName = quasi.right.type === 'arg' ? quasi.right.name : 'literal';
    throw new TransformError(
      `Binary expression evaluation failed: right operand '${rightName}' is undefined`,
      notNullish(callLoc),
    );
  }

  // Check if both values are numbers
  if (typeof leftValue !== 'number' || typeof rightValue !== 'number') {
    throw new TransformError(
      `Binary expression evaluation failed: operands must be numbers`,
      notNullish(callLoc),
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
          notNullish(callLoc),
        );
      }
      result = leftValue / rightValue;
      break;
    default:
      throw new TransformError(
        `Binary expression evaluation failed: unsupported operator '${String(quasi.operator)}'`,
        notNullish(callLoc),
      );
  }
  return result.toString();
}

function evaluateArrayMethodQuasi(
  quasi: {
    type: 'arrayMethod';
    arg: string;
    method: string;
    separator: string;
  },
  args: Record<
    string,
    string | number | boolean | (string | number)[] | undefined
  >,
  callLoc?: t.SourceLocation | null,
): string {
  const argValue = args[quasi.arg];
  if (argValue === undefined) {
    throw new TransformError(
      `Array argument '${quasi.arg}' is undefined`,
      notNullish(callLoc),
    );
  }
  if (!Array.isArray(argValue)) {
    throw new TransformError(
      `Argument '${quasi.arg}' is not an array, cannot call ${quasi.method}()`,
      notNullish(callLoc),
    );
  }

  // Currently only 'join' is supported
  return argValue.join(quasi.separator);
}

function evaluateArrayMapQuasi(
  quasi: {
    type: 'arrayMap';
    arg: string;
    mapParam: string;
    mapTemplate: OutputQuasi[];
  },
  args: Record<
    string,
    string | number | boolean | (string | number)[] | undefined
  >,
  callLoc?: t.SourceLocation | null,
): string {
  const argValue = args[quasi.arg];
  if (argValue === undefined) {
    throw new TransformError(
      `Array argument '${quasi.arg}' is undefined`,
      notNullish(callLoc),
    );
  }
  if (!Array.isArray(argValue)) {
    throw new TransformError(
      `Argument '${quasi.arg}' is not an array, cannot call map()`,
      notNullish(callLoc),
    );
  }

  // Apply the map transformation to each element
  const mappedResults: string[] = [];
  for (const element of argValue) {
    // Create args for the map callback
    const mapArgs = { [quasi.mapParam]: element };
    const mappedValue = evaluateOutput(quasi.mapTemplate, mapArgs, callLoc);
    mappedResults.push(mappedValue);
  }

  return mappedResults.join(','); // Default behavior for standalone map
}

function evaluateMapJoinQuasi(
  quasi: {
    type: 'mapJoin';
    arg: string;
    mapParam: string;
    mapTemplate: OutputQuasi[];
    joinSeparator: string;
  },
  args: Record<
    string,
    string | number | boolean | (string | number)[] | undefined
  >,
  callLoc?: t.SourceLocation | null,
): string {
  const argValue = args[quasi.arg];
  if (argValue === undefined) {
    throw new TransformError(
      `Array argument '${quasi.arg}' is undefined`,
      notNullish(callLoc),
    );
  }
  if (!Array.isArray(argValue)) {
    throw new TransformError(
      `Argument '${quasi.arg}' is not an array, cannot call map().join()`,
      notNullish(callLoc),
    );
  }

  // Apply the map transformation to each element
  const mappedResults: string[] = [];
  for (const element of argValue) {
    // Create args for the map callback
    const mapArgs = { [quasi.mapParam]: element };
    const mappedValue = evaluateOutput(quasi.mapTemplate, mapArgs, callLoc);
    mappedResults.push(mappedValue);
  }

  // Join with the specified separator
  return mappedResults.join(quasi.joinSeparator);
}
