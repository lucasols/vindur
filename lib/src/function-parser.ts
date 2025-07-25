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
): CompiledFunction {
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

    const output = parseTemplateOutput(fnExpression.body);
    return { type: 'destructured', args, output };
  } else {
    // Positional parameters
    const args: FunctionArg[] = params.map((param) => {
      if (t.isIdentifier(param)) {
        return {
          name: param.name,
          type: 'string', // Default type
          defaultValue: undefined,
        };
      }
      return { name: 'unknown', type: 'string', defaultValue: undefined };
    });

    const output = parseTemplateOutput(fnExpression.body);
    return { type: 'positional', args, output };
  }
}

function parseTemplateOutput(
  body: t.BlockStatement | t.Expression,
): OutputQuasi[] {
  if (t.isTemplateLiteral(body)) {
    return parseTemplateLiteral(body);
  } else if (t.isStringLiteral(body)) {
    // Parse string literal with ${} interpolations
    return parseStringWithInterpolation(body.value);
  } else if (t.isBlockStatement(body)) {
    // For block statements, look for a return statement with a template literal or string literal
    for (const stmt of body.body) {
      if (t.isReturnStatement(stmt) && stmt.argument) {
        if (t.isTemplateLiteral(stmt.argument)) {
          return parseTemplateLiteral(stmt.argument);
        } else if (t.isStringLiteral(stmt.argument)) {
          return parseStringWithInterpolation(stmt.argument.value);
        }
      }
    }
  }

  return [{ type: 'string', value: '' }];
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

function parseTemplateLiteral(template: t.TemplateLiteral): OutputQuasi[] {
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
          output.push({ type: 'arg', name: expr.name });
        } else if (t.isConditionalExpression(expr)) {
          // Handle ternary expressions
          const condition = parseTernaryCondition(expr.test);
          const ifTrue = parseQuasiFromExpression(expr.consequent);
          const ifFalse = parseQuasiFromExpression(expr.alternate);

          if (condition && ifTrue && ifFalse) {
            output.push({ type: 'ternary', condition, ifTrue, ifFalse });
          }
        }
      }
    }
  }

  return output;
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

function parseTernaryCondition(test: t.Expression): TernaryCondition | null {
  if (t.isBinaryExpression(test)) {
    const left =
      t.isExpression(test.left) ? parseConditionValue(test.left) : null;
    const right =
      t.isExpression(test.right) ? parseConditionValue(test.right) : null;
    const operator = test.operator;

    if (left && right && isValidComparisonOperator(operator)) {
      return [left, operator, right];
    }
  } else if (t.isIdentifier(test)) {
    // Handle simple boolean conditions like `disabled ? '0.5' : '1'`
    return [
      { type: 'arg', name: test.name },
      '===',
      { type: 'boolean', value: true },
    ];
  }

  return null;
}

function parseConditionValue(expr: t.Expression): TernaryConditionValue | null {
  if (t.isIdentifier(expr)) {
    return { type: 'arg', name: expr.name };
  } else if (t.isStringLiteral(expr)) {
    return { type: 'string', value: expr.value };
  } else if (t.isNumericLiteral(expr)) {
    return { type: 'number', value: expr.value };
  } else if (t.isBooleanLiteral(expr)) {
    return { type: 'boolean', value: expr.value };
  }

  return null;
}

function parseQuasiFromExpression(expr: t.Expression): OutputQuasi | null {
  if (t.isStringLiteral(expr)) {
    return { type: 'string', value: expr.value };
  } else if (t.isIdentifier(expr)) {
    return { type: 'arg', name: expr.name };
  }

  return null;
}
