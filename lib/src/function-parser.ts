import { types as t } from '@babel/core';
import { extractLiteralValue, getLiteralValueType } from './ast-utils';
import type {
  CompiledFunction,
  FunctionArg,
  OutputQuasi,
  TernaryConditionValue,
} from './types';

export function parseFunction(
  fnExpression: t.ArrowFunctionExpression | t.FunctionExpression,
  functionName?: string,
): CompiledFunction {
  const name = functionName ?? 'unknown';

  // Check for async functions during parsing
  if (fnExpression.async) {
    throw new Error(
      `vindurFn "${name}" cannot be async - functions must be synchronous for compile-time evaluation`,
    );
  }

  // Check for generator functions during parsing
  if (fnExpression.generator) {
    throw new Error(
      `vindurFn "${name}" cannot be a generator function - functions must return simple template strings`,
    );
  }

  const params = fnExpression.params;

  if (params.length === 1 && t.isObjectPattern(params[0])) {
    // Destructured object parameter
    const args: Record<string, FunctionArg> = {};

    for (const prop of params[0].properties) {
      if (
        t.isObjectProperty(prop)
        && t.isIdentifier(prop.key)
        && t.isIdentifier(prop.value)
      ) {
        args[prop.key.name] = {
          type: 'string', // Default type, could be inferred better
          defaultValue: undefined,
        };
      } else if (
        t.isObjectProperty(prop)
        && t.isIdentifier(prop.key)
        && t.isAssignmentPattern(prop.value)
        && t.isIdentifier(prop.value.left)
      ) {
        // Handle default values
        const defaultValue = extractLiteralValue(prop.value.right);

        args[prop.key.name] = {
          type: getLiteralValueType(defaultValue),
          defaultValue: defaultValue ?? undefined,
        };
      }
    }

    const validParameterNames = new Set(Object.keys(args));
    const output = parseTemplateOutput(fnExpression.body, name, validParameterNames);
    return { type: 'destructured', args, output };
  }

  // Positional parameters
  const args: FunctionArg[] = params.map((param) => {
    if (t.isIdentifier(param)) {
      return {
        name: param.name,
        type: 'string', // Default type
        defaultValue: undefined,
        optional: param.optional ?? false,
      };
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      // Handle default parameters
      const defaultValue = extractLiteralValue(param.right);
      return {
        name: param.left.name,
        type: getLiteralValueType(defaultValue),
        defaultValue: defaultValue ?? undefined,
        optional: true, // Parameters with defaults are optional
      };
    }
    return { name: 'unknown', type: 'string', defaultValue: undefined, optional: false };
  });

  const validParameterNames = new Set(args.map(arg => arg.name).filter((paramName): paramName is string => Boolean(paramName)));
  const output = parseTemplateOutput(fnExpression.body, name, validParameterNames);
  return { type: 'positional', args, output };
}

function parseTemplateOutput(
  body: t.BlockStatement | t.Expression,
  functionName: string,
  validParameterNames?: Set<string>,
): OutputQuasi[] {
  if (t.isTemplateLiteral(body)) {
    return parseTemplateLiteral(body, functionName, validParameterNames);
  } else if (t.isStringLiteral(body)) {
    // Parse string literal with ${} interpolations
    return parseStringWithInterpolation(body.value);
  } else if (t.isBlockStatement(body)) {
    // Validate block statement complexity during parsing
    const statements = body.body;
    if (statements.length !== 1) {
      throw new Error(
        `vindurFn "${functionName}" body is too complex - functions must contain only a single return statement or be arrow functions with template literals`,
      );
    }

    const statement = statements[0];
    if (!t.isReturnStatement(statement)) {
      throw new Error(
        `vindurFn "${functionName}" body must contain only a return statement`,
      );
    }

    if (!statement.argument) {
      throw new Error(
        `vindurFn "${functionName}" return statement must return a value`,
      );
    }

    // Parse the return expression based on its type
    if (t.isTemplateLiteral(statement.argument)) {
      return parseTemplateLiteral(statement.argument, functionName, validParameterNames);
    } else if (t.isStringLiteral(statement.argument)) {
      return parseStringWithInterpolation(statement.argument.value);
    } else if (t.isCallExpression(statement.argument)) {
      // Function calls in return position are not allowed
      throw new Error(
        `vindurFn "${functionName}" contains function calls which are not supported - functions must be self-contained`,
      );
    } else if (t.isMemberExpression(statement.argument)) {
      // Member expressions suggest external dependencies
      throw new Error(
        `vindurFn "${functionName}" contains member expressions which suggest external dependencies - functions must be self-contained`,
      );
    } else {
      throw new Error(
        `vindurFn "${functionName}" must return a template literal or string literal, got ${statement.argument.type}`,
      );
    }
  } else if (t.isCallExpression(body)) {
    // Function calls in return position are not allowed
    throw new Error(
      `vindurFn "${functionName}" contains function calls which are not supported - functions must be self-contained`,
    );
  } else if (t.isMemberExpression(body)) {
    // Member expressions suggest external dependencies
    throw new Error(
      `vindurFn "${functionName}" contains member expressions which suggest external dependencies - functions must be self-contained`,
    );
  } else {
    throw new Error(
      `vindurFn "${functionName}" must return a template literal or string literal, got ${body.type}`,
    );
  }
}

function parseStringWithInterpolation(str: string): OutputQuasi[] {
  const output: OutputQuasi[] = [];
  const parts = str.split(/(\$\{[^}]+\})/);

  for (const part of parts) {
    if (part.startsWith('${') && part.endsWith('}')) {
      // Extract the variable name from ${variable}
      const varName = part.slice(2, -1).trim();
      output.push({ type: 'arg', name: varName });
    } else if (part) {
      // Regular string part
      output.push({ type: 'string', value: part });
    }
  }

  return output;
}

function parseTemplateLiteral(
  template: t.TemplateLiteral,
  functionName: string,
  validParameterNames?: Set<string>,
): OutputQuasi[] {
  const output: OutputQuasi[] = [];

  for (let i = 0; i < template.quasis.length; i++) {
    const quasi = template.quasis[i];
    if (quasi?.value.cooked) {
      output.push({ type: 'string', value: quasi.value.cooked });
    }

    if (i < template.expressions.length) {
      const expr = template.expressions[i];
      if (expr && t.isExpression(expr)) {
        if (t.isIdentifier(expr)) {
          // Validate that the identifier is a valid parameter or built-in
          const builtInIdentifiers = new Set(['undefined', 'null', 'true', 'false']);
          if (validParameterNames && !validParameterNames.has(expr.name) && !builtInIdentifiers.has(expr.name)) {
            throw new Error(
              `Invalid interpolation used at \`... ${functionName} = vindurFn((${Array.from(validParameterNames).join(', ')}) => \` ... \${${expr.name}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
            );
          }
          output.push({ type: 'arg', name: expr.name });
        } else if (t.isConditionalExpression(expr)) {
          // Handle ternary expressions - validate their parts during parsing
          const condition = parseTernaryCondition(expr.test, functionName, validParameterNames);
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

          output.push({ type: 'ternary', condition, ifTrue, ifFalse });
        } else if (t.isBinaryExpression(expr)) {
          // Handle binary expressions like `multiplier * 8`
          const binaryExpr = parseBinaryExpression(expr, functionName, validParameterNames);
          if (binaryExpr) {
            output.push(binaryExpr);
          } else {
            // Simple binary expressions for comparisons in ternary conditions
            validateTemplateExpressionDuringParsing(expr.left, functionName, validParameterNames);
            validateTemplateExpressionDuringParsing(expr.right, functionName, validParameterNames);
          }
        } else if (t.isLogicalExpression(expr)) {
          // Handle logical expressions like || for default values
          validateTemplateExpressionDuringParsing(expr.left, functionName, validParameterNames);
          validateTemplateExpressionDuringParsing(expr.right, functionName, validParameterNames);
        } else if (
          t.isStringLiteral(expr)
          || t.isNumericLiteral(expr)
          || t.isBooleanLiteral(expr)
        ) {
          // Literals are allowed
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
  }

  return output;
}

function validateTemplateExpressionDuringParsing(
  expr: t.Expression | t.PrivateName,
  functionName: string,
  validParameterNames?: Set<string>,
): void {
  if (t.isExpression(expr)) {
    if (t.isIdentifier(expr)) {
      // Allow built-in JavaScript identifiers and valid parameters
      const builtInIdentifiers = new Set(['undefined', 'null', 'true', 'false']);
      if (validParameterNames && !validParameterNames.has(expr.name) && !builtInIdentifiers.has(expr.name)) {
        throw new Error(
          `Invalid interpolation used at \`... ${functionName} = vindurFn((${Array.from(validParameterNames).join(', ')}) => \` ... \${${expr.name}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
        );
      }
      return;
    } else if (t.isConditionalExpression(expr)) {
      // Ternary expressions are allowed - validate their parts
      validateTemplateExpressionDuringParsing(expr.test, functionName, validParameterNames);
      validateTemplateExpressionDuringParsing(expr.consequent, functionName, validParameterNames);
      validateTemplateExpressionDuringParsing(expr.alternate, functionName, validParameterNames);
    } else if (t.isBinaryExpression(expr)) {
      // Simple binary expressions for comparisons in ternary conditions
      validateTemplateExpressionDuringParsing(expr.left, functionName, validParameterNames);
      validateTemplateExpressionDuringParsing(expr.right, functionName, validParameterNames);
    } else if (t.isLogicalExpression(expr)) {
      // Handle logical expressions like || for default values
      validateTemplateExpressionDuringParsing(expr.left, functionName, validParameterNames);
      validateTemplateExpressionDuringParsing(expr.right, functionName, validParameterNames);
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

function isValidComparisonOperator(
  operator: string,
): operator is '===' | '!==' | '>' | '<' | '>=' | '<=' {
  return ['===', '!==', '>', '<', '>=', '<='].includes(operator);
}

type TernaryCondition = [
  TernaryConditionValue,
  '===' | '!==' | '>' | '<' | '>=' | '<=',
  TernaryConditionValue,
];

function parseTernaryCondition(
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

    const left = parseConditionValue(test.left, functionName, validParameterNames);
    const right = parseConditionValue(test.right, functionName, validParameterNames);
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
    if (validParameterNames && !validParameterNames.has(test.name) && !builtInIdentifiers.has(test.name)) {
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

function parseConditionValue(
  expr: t.Expression,
  functionName: string,
  validParameterNames?: Set<string>,
): TernaryConditionValue {
  if (t.isIdentifier(expr)) {
    // Validate that the identifier is a valid parameter or built-in
    const builtInIdentifiers = new Set(['undefined', 'null', 'true', 'false']);
    if (validParameterNames && !validParameterNames.has(expr.name) && !builtInIdentifiers.has(expr.name)) {
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

function parseBinaryExpression(
  expr: t.BinaryExpression,
  functionName: string,
  validParameterNames?: Set<string>,
): OutputQuasi | null {
  const { left, right, operator } = expr;
  
  // Only support basic arithmetic operators
  if (!['+', '-', '*', '/'].includes(operator)) {
    return null;
  }
  
  // Ensure operands are expressions
  if (!t.isExpression(left) || !t.isExpression(right)) {
    return null;
  }
  
  // Parse left operand
  const leftValue = parseConditionValue(left, functionName, validParameterNames);
  
  // Parse right operand  
  const rightValue = parseConditionValue(right, functionName, validParameterNames);
  
  if (operator !== '+' && operator !== '-' && operator !== '*' && operator !== '/') {
    return null;
  }
  
  return {
    type: 'binary',
    operator,
    left: leftValue,
    right: rightValue,
  };
}

function parseQuasiFromExpression(
  expr: t.Expression,
  functionName: string,
  validParameterNames?: Set<string>,
): OutputQuasi {
  if (t.isStringLiteral(expr)) {
    return { type: 'string', value: expr.value };
  } else if (t.isIdentifier(expr)) {
    // Validate that the identifier is a valid parameter or built-in
    const builtInIdentifiers = new Set(['undefined', 'null', 'true', 'false']);
    if (validParameterNames && !validParameterNames.has(expr.name) && !builtInIdentifiers.has(expr.name)) {
      throw new Error(
        `Invalid interpolation used at \`... ${functionName} = vindurFn((${Array.from(validParameterNames).join(', ')}) => \` ... \${${expr.name}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
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
    const condition = parseTernaryCondition(expr.test, functionName, validParameterNames);
    const ifTrue = parseQuasiFromExpression(expr.consequent, functionName, validParameterNames);
    const ifFalse = parseQuasiFromExpression(expr.alternate, functionName, validParameterNames);

    return { type: 'ternary', condition, ifTrue, ifFalse };
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
    `vindurFn "${functionName}" contains unsupported expression type in ternary: ${expr.type}`,
  );
}
