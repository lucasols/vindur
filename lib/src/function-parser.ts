import { types as t } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import { extractLiteralValue, getLiteralValueType } from './ast-utils';
import { parseTemplateLiteral } from './function-parser-quasi';
import type { CompiledFunction, FunctionArg, OutputQuasi } from './types';
import { filterWithNarrowing } from './utils';
import { TransformError } from './custom-errors';

export function parseFunction(
  fnExpression: t.ArrowFunctionExpression | t.FunctionExpression,
  functionName?: string,
  filename?: string,
): CompiledFunction {
  const name = functionName ?? 'unknown';

  // Check for async functions during parsing
  if (fnExpression.async) {
    throw new TransformError(
      `vindurFn "${name}" cannot be async - functions must be synchronous for compile-time evaluation`,
      notNullish(fnExpression.loc),
      filename,
    );
  }

  // Check for generator functions during parsing
  if (fnExpression.generator) {
    throw new TransformError(
      `vindurFn "${name}" cannot be a generator function - functions must return simple template strings`,
      notNullish(fnExpression.loc),
      filename,
    );
  }

  const params = fnExpression.params;

  // Handle destructured object parameter, with or without default value for the entire object
  const objectPattern =
    params.length === 1 && t.isObjectPattern(params[0]) ? params[0]
    : (
      params.length === 1
      && t.isAssignmentPattern(params[0])
      && t.isObjectPattern(params[0].left)
    ) ?
      params[0].left
    : null;

  if (objectPattern) {
    // Destructured object parameter
    const args: Record<string, FunctionArg> = {};

    for (const prop of objectPattern.properties) {
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
      filename,
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
    filename,
  );
  return { type: 'positional', args, output };
}

function parseTemplateOutput(
  body: t.BlockStatement | t.Expression,
  functionName: string,
  validParameterNames?: Set<string>,
  filename?: string,
): OutputQuasi[] {
  if (t.isTemplateLiteral(body)) {
    return parseTemplateLiteral(
      body,
      functionName,
      validParameterNames,
      filename,
    );
  } else if (t.isStringLiteral(body)) {
    // Parse string literal with ${} interpolations
    return parseStringWithInterpolation(body.value);
  } else if (t.isBlockStatement(body)) {
    // Validate block statement complexity during parsing
    const statements = body.body;
    if (statements.length !== 1) {
      throw new TransformError(
        `vindurFn "${functionName}" body is too complex - functions must contain only a single return statement or be arrow functions with template literals`,
        notNullish(body.loc),
        filename,
      );
    }

    const statement = statements[0];
    if (!statement || !t.isReturnStatement(statement)) {
      throw new TransformError(
        `vindurFn "${functionName}" body must contain only a return statement`,
        notNullish(statement?.loc || body.loc),
        filename,
      );
    }

    if (!statement.argument) {
      throw new TransformError(
        `vindurFn "${functionName}" return statement must return a value`,
        notNullish(statement.loc),
        filename,
      );
    }

    // Parse the return expression based on its type
    if (t.isTemplateLiteral(statement.argument)) {
      return parseTemplateLiteral(
        statement.argument,
        functionName,
        validParameterNames,
        filename,
      );
    } else if (t.isStringLiteral(statement.argument)) {
      return parseStringWithInterpolation(statement.argument.value);
    } else if (t.isCallExpression(statement.argument)) {
      // Function calls in return position are not allowed
      throw new TransformError(
        `vindurFn "${functionName}" contains function calls which are not supported - functions must be self-contained`,
        notNullish(statement.argument.loc),
        filename,
      );
    } else if (t.isMemberExpression(statement.argument)) {
      // Member expressions suggest external dependencies
      throw new TransformError(
        `vindurFn "${functionName}" contains member expressions which suggest external dependencies - functions must be self-contained`,
        notNullish(statement.argument.loc),
        filename,
      );
    } else {
      throw new TransformError(
        `vindurFn "${functionName}" must return a template literal or string literal, got ${statement.argument.type}`,
        notNullish(statement.argument.loc),
        filename,
      );
    }
  } else if (t.isCallExpression(body)) {
    // Function calls in return position are not allowed
    throw new TransformError(
      `vindurFn "${functionName}" contains function calls which are not supported - functions must be self-contained`,
      notNullish(body.loc),
      filename,
    );
  } else if (t.isMemberExpression(body)) {
    // Member expressions suggest external dependencies
    throw new TransformError(
      `vindurFn "${functionName}" contains member expressions which suggest external dependencies - functions must be self-contained`,
      notNullish(body.loc),
      filename,
    );
  } else {
    throw new TransformError(
      `vindurFn "${functionName}" must return a template literal or string literal, got ${body.type}`,
      notNullish(body.loc),
      filename,
    );
  }
}

const INTERPOLATION_REGEX = /(\$\{[^}]+\})/;

function parseStringWithInterpolation(str: string): OutputQuasi[] {
  const output: OutputQuasi[] = [];
  const parts = str.split(INTERPOLATION_REGEX);

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
