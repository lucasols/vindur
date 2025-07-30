import { types as t } from '@babel/core';
import { extractLiteralValue, getLiteralValueType } from './ast-utils';
import type { CompiledFunction, FunctionArg, OutputQuasi } from './types';
import { filterWithNarrowing } from './utils';
import { parseTemplateLiteral } from './function-parser-quasi';

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
    const output = parseTemplateOutput(
      fnExpression.body,
      name,
      validParameterNames,
    );
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
    return {
      name: 'unknown',
      type: 'string',
      defaultValue: undefined,
      optional: false,
    };
  });

  const validParameterNames = new Set(
    filterWithNarrowing(
      args.map((arg) => arg.name),
      (paramName) => (typeof paramName === 'string' ? paramName : false),
    ),
  );
  const output = parseTemplateOutput(
    fnExpression.body,
    name,
    validParameterNames,
  );
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
      return parseTemplateLiteral(
        statement.argument,
        functionName,
        validParameterNames,
      );
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
