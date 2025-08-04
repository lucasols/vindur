import { types as t } from '@babel/core';
import type { OutputQuasi } from './types';
import { parseTernaryCondition } from './function-parser-ternary';
import { parseBinaryExpression } from './function-parser-binary';
import { TransformError } from './custom-errors';

export function parseQuasiFromExpression(
  expr: t.Expression,
  functionName: string,
  validParameterNames?: Set<string>,
): OutputQuasi {
  if (t.isStringLiteral(expr)) {
    return { type: 'string', value: expr.value };
  } else if (t.isIdentifier(expr)) {
    // Validate that the identifier is a valid parameter or built-in
    const builtInIdentifiers = new Set(['undefined', 'null', 'true', 'false']);
    if (
      validParameterNames
      && !validParameterNames.has(expr.name)
      && !builtInIdentifiers.has(expr.name)
    ) {
      throw new TransformError(
        `Invalid interpolation used at \`... ${functionName} = vindurFn((${Array.from(validParameterNames).join(', ')}) => \` ... \${${expr.name}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
        expr.loc,
      );
    }
    return { type: 'arg', name: expr.name };
  } else if (t.isTemplateLiteral(expr)) {
    // Handle template literals in ternary expressions
    const parts = parseTemplateLiteral(expr, functionName, validParameterNames);

    // If it's a single string part, return it directly
    if (parts.length === 1 && parts[0]?.type === 'string') {
      return parts[0];
    }

    // Otherwise, return as a template type
    return { type: 'template', parts };
  } else if (t.isConditionalExpression(expr)) {
    // Handle nested ternary expressions
    const condition = parseTernaryCondition(
      expr.test,
      functionName,
      validParameterNames,
    );
    const ifTrue = parseQuasiFromExpression(
      expr.consequent,
      functionName,
      validParameterNames,
    );
    const ifFalse = parseQuasiFromExpression(
      expr.alternate,
      functionName,
      validParameterNames,
    );

    return { type: 'ternary', condition, ifTrue, ifFalse };
  } else if (t.isBinaryExpression(expr)) {
    // Handle binary expressions (arithmetic operations)
    const binaryResult = parseBinaryExpression(
      expr,
      functionName,
      validParameterNames,
    );
    if (binaryResult) {
      return binaryResult;
    }
    // If parseBinaryExpression returns null, fall through to the error
  } else if (t.isCallExpression(expr)) {
    // Function calls are not allowed
    throw new TransformError(
      `vindurFn "${functionName}" contains function calls which are not supported - functions must be self-contained`,
      expr.loc,
    );
  } else if (t.isMemberExpression(expr)) {
    // Member expressions suggest external dependencies
    throw new TransformError(
      `vindurFn "${functionName}" contains member expressions which suggest external dependencies - functions must be self-contained`,
      expr.loc,
    );
  }

  throw new TransformError(
    `vindurFn "${functionName}" contains unsupported expression type in ternary: ${expr.type}`,
    expr.loc,
  );
}

export function parseTemplateLiteral(
  template: t.TemplateLiteral,
  functionName: string,
  validParameterNames?: Set<string>,
): OutputQuasi[] {
  const output: OutputQuasi[] = [];

  for (let i = 0; i < template.quasis.length; i++) {
    const quasi = template.quasis[i];

    if (quasi && quasi.value.raw !== '') {
      output.push({ type: 'string', value: quasi.value.raw });
    }

    const expr = template.expressions[i];
    if (expr && t.isExpression(expr)) {
      const quasiFromExpr = parseQuasiFromExpression(
        expr,
        functionName,
        validParameterNames,
      );
      output.push(quasiFromExpr);
    }
  }

  return output;
}
