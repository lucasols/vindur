import { types as t } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import { TransformError } from './custom-errors';
import { parseBinaryExpression } from './function-parser-binary';
import { parseTernaryCondition } from './function-parser-ternary';
import type { OutputQuasi } from './types';

export function parseQuasiFromExpression(
  expr: t.Expression,
  functionName: string,
  validParameterNames?: Set<string>,
  filename?: string,
): OutputQuasi {
  if (t.isStringLiteral(expr)) {
    return { type: 'string', value: expr.value };
  } else if (t.isNumericLiteral(expr)) {
    return { type: 'string', value: String(expr.value) };
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
        notNullish(expr.loc),
        { filename, ignoreInLint: true },
      );
    }
    return { type: 'arg', name: expr.name };
  } else if (t.isTemplateLiteral(expr)) {
    // Handle template literals in ternary expressions
    const parts = parseTemplateLiteral(
      expr,
      functionName,
      validParameterNames,
      filename,
    );

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
      filename,
    );
    const ifTrue = parseQuasiFromExpression(
      expr.consequent,
      functionName,
      validParameterNames,
      filename,
    );
    const ifFalse = parseQuasiFromExpression(
      expr.alternate,
      functionName,
      validParameterNames,
      filename,
    );

    return { type: 'ternary', condition, ifTrue, ifFalse };
  } else if (t.isBinaryExpression(expr)) {
    // Handle binary expressions (arithmetic operations)
    const binaryResult = parseBinaryExpression(
      expr,
      functionName,
      validParameterNames,
      filename,
    );
    if (binaryResult) {
      return binaryResult;
    }
    // If parseBinaryExpression returns null, fall through to the error
  } else if (t.isCallExpression(expr)) {
    // Handle array method calls
    if (
      t.isMemberExpression(expr.callee)
      && t.isIdentifier(expr.callee.property)
    ) {
      const methodName = expr.callee.property.name;

      if (methodName === 'join') {
        // Handle .join() calls (both direct and chained)
        return parseJoinCall(expr, functionName, validParameterNames, filename);
      } else if (methodName === 'map') {
        // Handle standalone .map() calls
        return parseMapCall(expr, functionName, validParameterNames, filename);
      } else {
        throw new TransformError(
          `vindurFn "${functionName}" contains unsupported array method "${methodName}" - only .map() and .join() are supported`,
          notNullish(expr.loc),
          { filename },
        );
      }
    } else {
      // Other function calls are not allowed
      throw new TransformError(
        `vindurFn "${functionName}" contains unsupported function calls - only array methods like .map() and .join() are supported`,
        notNullish(expr.loc),
        { filename },
      );
    }
  } else if (t.isMemberExpression(expr)) {
    // Member expressions suggest external dependencies
    throw new TransformError(
      `vindurFn "${functionName}" contains member expressions which suggest external dependencies - functions must be self-contained`,
      notNullish(expr.loc),
      { filename },
    );
  }

  throw new TransformError(
    `vindurFn "${functionName}" contains unsupported expression type in ternary: ${expr.type}`,
    notNullish(expr.loc),
    { filename },
  );
}

export function parseTemplateLiteral(
  template: t.TemplateLiteral,
  functionName: string,
  validParameterNames?: Set<string>,
  filename?: string,
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
        filename,
      );
      output.push(quasiFromExpr);
    }
  }

  return output;
}

function parseJoinCall(
  expr: t.CallExpression,
  functionName: string,
  validParameterNames?: Set<string>,
  filename?: string,
): OutputQuasi {
  if (
    !t.isMemberExpression(expr.callee)
    || !t.isIdentifier(expr.callee.property)
  ) {
    throw new TransformError(
      `Invalid join call structure`,
      notNullish(expr.loc),
      { filename },
    );
  }

  // Extract separator argument (default to comma)
  let separator = ', ';
  if (expr.arguments.length === 1 && t.isStringLiteral(expr.arguments[0])) {
    separator = expr.arguments[0].value;
  } else if (expr.arguments.length > 1) {
    throw new TransformError(
      `Array.join() method only supports a single string argument`,
      notNullish(expr.loc),
      { filename },
    );
  }

  // Check if this is a direct join call on an array parameter
  if (t.isIdentifier(expr.callee.object)) {
    const argName = expr.callee.object.name;

    // Validate that the object is a valid parameter
    if (validParameterNames && !validParameterNames.has(argName)) {
      throw new TransformError(
        `Invalid object in method call: "${argName}" is not a valid parameter`,
        notNullish(expr.loc),
        { filename },
      );
    }

    return {
      type: 'arrayMethod',
      arg: argName,
      method: 'join',
      separator,
    };
  }

  // Check if this is a chained call like array.map().join()
  if (t.isCallExpression(expr.callee.object)) {
    const mapCall = expr.callee.object;

    if (
      t.isMemberExpression(mapCall.callee)
      && t.isIdentifier(mapCall.callee.object)
      && t.isIdentifier(mapCall.callee.property)
      && mapCall.callee.property.name === 'map'
    ) {
      const argName = mapCall.callee.object.name;

      // Validate array parameter
      if (validParameterNames && !validParameterNames.has(argName)) {
        throw new TransformError(
          `Invalid object in chained method call: "${argName}" is not a valid parameter`,
          notNullish(expr.loc),
          { filename },
        );
      }

      // Parse the map function
      const mapFunction = parseMapFunction(mapCall, functionName, filename);

      return {
        type: 'mapJoin',
        arg: argName,
        mapParam: mapFunction.param,
        mapTemplate: mapFunction.template,
        joinSeparator: separator,
      };
    }
  }

  throw new TransformError(
    `Unsupported join call - can only call .join() on array parameters or .map() results`,
    notNullish(expr.loc),
    { filename },
  );
}

function parseMapCall(
  expr: t.CallExpression,
  functionName: string,
  validParameterNames?: Set<string>,
  filename?: string,
): OutputQuasi {
  if (
    !t.isMemberExpression(expr.callee)
    || !t.isIdentifier(expr.callee.object)
  ) {
    throw new TransformError(
      `Invalid map call structure`,
      notNullish(expr.loc),
      { filename },
    );
  }

  const argName = expr.callee.object.name;

  // Validate that the object is a valid parameter
  if (validParameterNames && !validParameterNames.has(argName)) {
    throw new TransformError(
      `Invalid object in method call: "${argName}" is not a valid parameter`,
      notNullish(expr.loc),
      { filename },
    );
  }

  // Parse the map function
  const mapFunction = parseMapFunction(expr, functionName, filename);

  return {
    type: 'arrayMap',
    arg: argName,
    mapParam: mapFunction.param,
    mapTemplate: mapFunction.template,
  };
}

function parseMapFunction(
  mapCall: t.CallExpression,
  functionName: string,
  filename?: string,
): { param: string; template: OutputQuasi[] } {
  // Map should have exactly one argument (the callback function)
  if (mapCall.arguments.length !== 1) {
    throw new TransformError(
      `Array.map() method requires exactly one argument`,
      notNullish(mapCall.loc),
      { filename },
    );
  }

  const callback = mapCall.arguments[0];

  // The callback must be an arrow function
  if (!t.isArrowFunctionExpression(callback)) {
    throw new TransformError(
      `Array.map() callback must be an arrow function`,
      notNullish(callback?.loc || mapCall.loc),
      { filename },
    );
  }

  // The arrow function must have exactly one parameter
  if (callback.params.length !== 1 || !t.isIdentifier(callback.params[0])) {
    throw new TransformError(
      `Array.map() callback must have exactly one parameter`,
      notNullish(callback.loc),
      { filename },
    );
  }

  const paramName = callback.params[0].name;

  // The body must be a template literal
  if (!t.isTemplateLiteral(callback.body)) {
    throw new TransformError(
      `Array.map() callback must return a template literal (e.g., \`\${n}ms\`)`,
      notNullish(callback.body.loc || callback.loc),
      { filename },
    );
  }

  // Parse the template literal with the callback parameter as a valid name
  const validNames = new Set([paramName]);
  const templateParts = parseTemplateLiteral(
    callback.body,
    functionName,
    validNames,
    filename,
  );

  return {
    param: paramName,
    template: templateParts,
  };
}
