import { types as t } from '@babel/core';
import type { TernaryConditionValue } from './types';
import { isValidComparisonOperator } from './function-parser.type-guards';

type TernaryCondition = [
  TernaryConditionValue,
  '===' | '!==' | '>' | '<' | '>=' | '<=',
  TernaryConditionValue,
];

export function parseTernaryCondition(
  test: t.Expression,
  functionName: string,
  validParameterNames?: Set<string>,
): TernaryCondition {
  if (t.isBinaryExpression(test)) {
    if (!t.isExpression(test.left) || !t.isExpression(test.right)) {
      throw new Error(
        `vindurFn "${functionName}" contains invalid binary expression in ternary condition`,
      );
    }

    const left = parseConditionValue(
      test.left,
      functionName,
      validParameterNames,
    );
    const right = parseConditionValue(
      test.right,
      functionName,
      validParameterNames,
    );
    const operator = test.operator;

    if (isValidComparisonOperator(operator)) {
      return [left, operator, right];
    } else {
      throw new Error(
        `vindurFn "${functionName}" contains unsupported comparison operator "${operator}" - only ===, !==, >, <, >=, <= are supported`,
      );
    }
  } else if (t.isIdentifier(test)) {
    // Handle simple boolean conditions like `disabled ? '0.5' : '1'`
    // Validate that the identifier is a valid parameter or built-in
    const builtInIdentifiers = new Set(['undefined', 'null', 'true', 'false']);
    if (
      validParameterNames
      && !validParameterNames.has(test.name)
      && !builtInIdentifiers.has(test.name)
    ) {
      throw new Error(
        `Invalid interpolation used at \`... ${functionName} = vindurFn((${Array.from(validParameterNames).join(', ')}) => \` ... \${${test.name}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
      );
    }
    return [
      { type: 'arg', name: test.name },
      '===',
      { type: 'boolean', value: true },
    ];
  }

  throw new Error(
    `vindurFn "${functionName}" contains unsupported ternary condition type: ${test.type}`,
  );
}

export function parseConditionValue(
  expr: t.Expression,
  functionName: string,
  validParameterNames?: Set<string>,
): TernaryConditionValue {
  if (t.isIdentifier(expr)) {
    // Validate that the identifier is a valid parameter or built-in
    const builtInIdentifiers = new Set(['undefined', 'null', 'true', 'false']);
    if (
      validParameterNames
      && !validParameterNames.has(expr.name)
      && !builtInIdentifiers.has(expr.name)
    ) {
      throw new Error(
        `Invalid interpolation used at \`... ${functionName} = vindurFn((${Array.from(validParameterNames).join(', ')}) => \` ... \${${expr.name}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
      );
    }
    return { type: 'arg', name: expr.name };
  } else if (t.isStringLiteral(expr)) {
    return { type: 'string', value: expr.value };
  } else if (t.isNumericLiteral(expr)) {
    return { type: 'number', value: expr.value };
  } else if (t.isBooleanLiteral(expr)) {
    return { type: 'boolean', value: expr.value };
  } else if (t.isCallExpression(expr)) {
    // Function calls are not allowed
    throw new Error(
      `vindurFn "${functionName}" contains function calls which are not supported - functions must be self-contained`,
    );
  } else if (t.isMemberExpression(expr)) {
    // Member expressions suggest external dependencies
    throw new Error(
      `vindurFn "${functionName}" contains member expressions which suggest external dependencies - functions must be self-contained`,
    );
  }

  throw new Error(
    `vindurFn "${functionName}" contains unsupported condition value type: ${expr.type}`,
  );
}