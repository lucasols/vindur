import { types as t } from '@babel/core';

export function validateTemplateExpressionDuringParsing(
  expr: t.Expression | t.PrivateName,
  functionName: string,
  validParameterNames?: Set<string>,
): void {
  if (t.isExpression(expr)) {
    if (t.isIdentifier(expr)) {
      // Allow built-in JavaScript identifiers and valid parameters
      const builtInIdentifiers = new Set([
        'undefined',
        'null',
        'true',
        'false',
      ]);
      if (
        validParameterNames
        && !validParameterNames.has(expr.name)
        && !builtInIdentifiers.has(expr.name)
      ) {
        throw new Error(
          `Invalid interpolation used at \`... ${functionName} = vindurFn((${Array.from(validParameterNames).join(', ')}) => \` ... \${${expr.name}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
        );
      }
      return;
    } else if (t.isConditionalExpression(expr)) {
      // Ternary expressions are allowed - validate their parts
      validateTemplateExpressionDuringParsing(
        expr.test,
        functionName,
        validParameterNames,
      );
      validateTemplateExpressionDuringParsing(
        expr.consequent,
        functionName,
        validParameterNames,
      );
      validateTemplateExpressionDuringParsing(
        expr.alternate,
        functionName,
        validParameterNames,
      );
    } else if (t.isBinaryExpression(expr)) {
      // Simple binary expressions for comparisons in ternary conditions
      validateTemplateExpressionDuringParsing(
        expr.left,
        functionName,
        validParameterNames,
      );
      validateTemplateExpressionDuringParsing(
        expr.right,
        functionName,
        validParameterNames,
      );
    } else if (t.isLogicalExpression(expr)) {
      // Handle logical expressions like || for default values
      validateTemplateExpressionDuringParsing(
        expr.left,
        functionName,
        validParameterNames,
      );
      validateTemplateExpressionDuringParsing(
        expr.right,
        functionName,
        validParameterNames,
      );
    } else if (
      t.isStringLiteral(expr)
      || t.isNumericLiteral(expr)
      || t.isBooleanLiteral(expr)
    ) {
      // Literals are allowed
      return;
    } else if (t.isCallExpression(expr)) {
      // Function calls are not allowed - suggests external dependencies
      throw new Error(
        `vindurFn "${functionName}" contains function calls which are not supported - functions must be self-contained`,
      );
    } else if (t.isMemberExpression(expr)) {
      // Member expressions suggest external dependencies
      throw new Error(
        `vindurFn "${functionName}" contains member expressions which suggest external dependencies - functions must be self-contained`,
      );
    } else {
      throw new Error(
        `vindurFn "${functionName}" contains unsupported expression type: ${expr.type}`,
      );
    }
  }
}

export function validateFunctionExpressionStructure(
  expr: t.Expression,
  functionName: string,
  validParameterNames?: Set<string>,
): void {
  if (t.isIdentifier(expr)) {
    // Allow built-in JavaScript identifiers and valid parameters
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
  } else if (t.isConditionalExpression(expr)) {
    // Ternary expressions are allowed - validate their parts
    if (t.isExpression(expr.test)) {
      validateFunctionExpressionStructure(expr.test, functionName, validParameterNames);
    }
    validateFunctionExpressionStructure(expr.consequent, functionName, validParameterNames);
    validateFunctionExpressionStructure(expr.alternate, functionName, validParameterNames);
  } else if (t.isBinaryExpression(expr)) {
    // Simple binary expressions for comparisons in ternary conditions
    if (t.isExpression(expr.left)) {
      validateFunctionExpressionStructure(expr.left, functionName, validParameterNames);
    }
    if (t.isExpression(expr.right)) {
      validateFunctionExpressionStructure(expr.right, functionName, validParameterNames);
    }
  } else if (t.isLogicalExpression(expr)) {
    // Handle logical expressions like || for default values
    validateFunctionExpressionStructure(expr.left, functionName, validParameterNames);
    validateFunctionExpressionStructure(expr.right, functionName, validParameterNames);
  } else if (
    !t.isStringLiteral(expr)
    && !t.isNumericLiteral(expr)
    && !t.isBooleanLiteral(expr)
  ) {
    if (t.isCallExpression(expr)) {
      // Function calls are not allowed - suggests external dependencies
      throw new Error(
        `vindurFn "${functionName}" contains function calls which are not supported - functions must be self-contained`,
      );
    } else if (t.isMemberExpression(expr)) {
      // Member expressions suggest external dependencies
      throw new Error(
        `vindurFn "${functionName}" contains member expressions which suggest external dependencies - functions must be self-contained`,
      );
    } else {
      throw new Error(
        `vindurFn "${functionName}" contains unsupported expression type: ${expr.type}`,
      );
    }
  }
}