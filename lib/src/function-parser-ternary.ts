import { types as t } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import type { TernaryConditionValue } from './types';
import { isValidComparisonOperator } from './function-parser.type-guards';
import { TransformError } from './custom-errors';

type TernaryCondition = [
  TernaryConditionValue,
  '===' | '!==' | '>' | '<' | '>=' | '<=' | 'isArray',
  TernaryConditionValue,
];

export function parseTernaryCondition(
  test: t.Expression,
  functionName: string,
  validParameterNames?: Set<string>,
  filename?: string,
): TernaryCondition {
  if (t.isBinaryExpression(test)) {
    if (!t.isExpression(test.left) || !t.isExpression(test.right)) {
      throw new TransformError(
        `vindurFn "${functionName}" contains invalid binary expression in ternary condition`,
        notNullish(test.loc),
        filename,
      );
    }

    const left = parseConditionValue(
      test.left,
      functionName,
      validParameterNames,
      filename,
    );
    const right = parseConditionValue(
      test.right,
      functionName,
      validParameterNames,
      filename,
    );
    const operator = test.operator;

    if (isValidComparisonOperator(operator)) {
      return [left, operator, right];
    } else {
      throw new TransformError(
        `vindurFn "${functionName}" contains unsupported comparison operator "${operator}" - only ===, !==, >, <, >=, <= are supported`,
        notNullish(test.loc),
        filename,
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
      throw new TransformError(
        `Invalid interpolation used at \`... ${functionName} = vindurFn((${Array.from(validParameterNames).join(', ')}) => \` ... \${${test.name}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
        notNullish(test.loc),
        filename,
      );
    }
    return [
      { type: 'arg', name: test.name },
      '===',
      { type: 'boolean', value: true },
    ];
  } else if (t.isCallExpression(test)) {
    // Handle Array.isArray() calls
    if (
      t.isMemberExpression(test.callee)
      && t.isIdentifier(test.callee.object)
      && test.callee.object.name === 'Array'
      && t.isIdentifier(test.callee.property)
      && test.callee.property.name === 'isArray'
      && test.arguments.length === 1
      && t.isIdentifier(test.arguments[0])
    ) {
      const argName = test.arguments[0].name;

      // Validate that the argument is a valid parameter
      if (validParameterNames && !validParameterNames.has(argName)) {
        throw new TransformError(
          `Invalid argument in Array.isArray() call: "${argName}" is not a valid parameter`,
          notNullish(test.loc),
          filename,
        );
      }

      return [
        { type: 'isArray', arg: argName },
        'isArray',
        { type: 'boolean', value: true },
      ];
    } else {
      throw new TransformError(
        `vindurFn "${functionName}" contains unsupported function call in ternary condition - only Array.isArray() is supported`,
        notNullish(test.loc),
        filename,
      );
    }
  }

  throw new TransformError(
    `vindurFn "${functionName}" contains unsupported ternary condition type: ${test.type}`,
    notNullish(test.loc),
    filename,
  );
}

export function parseConditionValue(
  expr: t.Expression,
  functionName: string,
  validParameterNames?: Set<string>,
  filename?: string,
): TernaryConditionValue {
  if (t.isIdentifier(expr)) {
    // Validate that the identifier is a valid parameter or built-in
    const builtInIdentifiers = new Set(['undefined', 'null', 'true', 'false']);
    if (
      validParameterNames
      && !validParameterNames.has(expr.name)
      && !builtInIdentifiers.has(expr.name)
    ) {
      throw new TransformError(
        `Invalid interpolation used at \`... ${functionName} = vindurFn((${Array.from(validParameterNames).join(', ')}) => \` ... \${${expr.name}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
        notNullish(expr.loc),
        filename,
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
    throw new TransformError(
      `vindurFn "${functionName}" contains function calls which are not supported - functions must be self-contained`,
      notNullish(expr.loc),
      filename,
    );
  } else if (t.isMemberExpression(expr)) {
    // Member expressions suggest external dependencies
    throw new TransformError(
      `vindurFn "${functionName}" contains member expressions which suggest external dependencies - functions must be self-contained`,
      notNullish(expr.loc),
      filename,
    );
  }

  throw new TransformError(
    `vindurFn "${functionName}" contains unsupported condition value type: ${expr.type}`,
    notNullish(expr.loc),
    filename,
  );
}
