import type { PluginObj } from '@babel/core';
import { types as t } from '@babel/core';
import type { VindurPluginState } from './babel-plugin';
import { parseFunction } from './function-parser';

export function validateVindurFunction(
  fnExpression: t.ArrowFunctionExpression | t.FunctionExpression,
  functionName: string,
): void {
  // Check for async functions
  if (fnExpression.async) {
    throw new Error(
      `vindurFn "${functionName}" cannot be async - functions must be synchronous for compile-time evaluation`,
    );
  }

  // Check for generator functions
  if (fnExpression.generator) {
    throw new Error(
      `vindurFn "${functionName}" cannot be a generator function - functions must return simple template strings`,
    );
  }

  // Validate function body complexity
  if (t.isBlockStatement(fnExpression.body)) {
    // Block statement functions are allowed if they only contain a single return statement
    const statements = fnExpression.body.body;
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

    // Validate the return expression
    validateReturnExpression(statement.argument, functionName);
  } else {
    // Arrow function body - validate the expression
    validateReturnExpression(fnExpression.body, functionName);
  }
}

function validateReturnExpression(
  expr: t.Expression,
  functionName: string,
): void {
  if (t.isTemplateLiteral(expr)) {
    // Template literals are allowed - validate expressions within them
    for (const expression of expr.expressions) {
      if (t.isExpression(expression)) {
        validateTemplateExpression(expression, functionName);
      }
    }
  } else if (t.isStringLiteral(expr)) {
    // String literals are allowed
    return;
  } else if (t.isCallExpression(expr)) {
    // Function calls in return position are not allowed
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
      `vindurFn "${functionName}" must return a template literal or string literal, got ${expr.type}`,
    );
  }
}

function validateTemplateExpression(
  expr: t.Expression,
  functionName: string,
): void {
  if (t.isIdentifier(expr)) {
    // Identifiers (parameters) are allowed
    return;
  } else if (t.isConditionalExpression(expr)) {
    // Ternary expressions are allowed - validate their parts
    validateTemplateExpression(expr.test, functionName);
    validateTemplateExpression(expr.consequent, functionName);
    validateTemplateExpression(expr.alternate, functionName);
  } else if (t.isBinaryExpression(expr)) {
    // Simple binary expressions for comparisons in ternary conditions
    if (t.isExpression(expr.left)) {
      validateTemplateExpression(expr.left, functionName);
    }
    if (t.isExpression(expr.right)) {
      validateTemplateExpression(expr.right, functionName);
    }
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

export function createExtractVindurFunctionsPlugin(
  filePath: string,
  compiledFunctions: VindurPluginState['compiledFunctions'],
): PluginObj {
  return {
    visitor: {
      ExportNamedDeclaration(path) {
        if (
          path.node.declaration
          && t.isVariableDeclaration(path.node.declaration)
        ) {
          for (const declarator of path.node.declaration.declarations) {
            if (
              t.isVariableDeclarator(declarator)
              && t.isIdentifier(declarator.id)
              && declarator.init
              && t.isCallExpression(declarator.init)
              && t.isIdentifier(declarator.init.callee)
              && declarator.init.callee.name === 'vindurFn'
              && declarator.init.arguments.length === 1
            ) {
              const arg = declarator.init.arguments[0];
              if (
                t.isArrowFunctionExpression(arg)
                || t.isFunctionExpression(arg)
              ) {
                // Validate function before parsing
                validateVindurFunction(arg, declarator.id.name);

                const name = declarator.id.name;
                const compiledFn = parseFunction(arg);

                compiledFunctions[filePath] ??= {};
                compiledFunctions[filePath][name] = compiledFn;
              } else {
                throw new Error(
                  `vindurFn must be called with a function expression, got ${typeof arg} in function "${declarator.id.name}"`,
                );
              }
            }
          }
        }
      },
    },
  };
}
