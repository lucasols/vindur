import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import { extractArgumentValue, extractLiteralValue } from '../ast-utils';
import { evaluateOutput } from '../evaluation';
import type { FunctionArg } from '../types';
import type { CssProcessingContext } from '../css-processing';
import { resolveThemeColorCallExpression } from './theme-colors';
import { resolveImportedConstant } from './file-processing';

export function resolveVariable(
  variableName: string,
  path: NodePath,
): string | null {
  // Find the variable declaration in the current scope or parent scopes
  const binding = path.scope.getBinding(variableName);

  if (!binding?.path) return null;

  const declarationPath = binding.path;

  // Handle variable declarations
  if (declarationPath.isVariableDeclarator() && declarationPath.node.init) {
    const init = declarationPath.node.init;

    const literalValue = extractLiteralValue(init);
    if (literalValue !== null) {
      return String(literalValue);
    } else if (t.isBinaryExpression(init)) {
      // Try to resolve simple binary expressions like `margin * 2`
      const resolved = resolveBinaryExpression(init, path);
      return resolved;
    }
  }

  return null;
}

export function resolveBinaryExpression(
  expr: t.BinaryExpression,
  path: NodePath,
  context?: CssProcessingContext,
): string | null {
  const { left, right, operator } = expr;

  let leftValue: number | null = null;
  let rightValue: number | null = null;

  // Resolve left operand
  const leftLiteral = extractLiteralValue(left);
  if (typeof leftLiteral === 'number') {
    leftValue = leftLiteral;
  } else if (t.isIdentifier(left)) {
    // Try to resolve as imported constant first if context is available
    if (context) {
      const importedConstant = resolveImportedConstant(left.name, context);
      if (importedConstant !== null && typeof importedConstant === 'number') {
        leftValue = importedConstant;
      }
    }

    // Fall back to local variable resolution
    if (leftValue === null) {
      const resolved = resolveVariable(left.name, path);
      if (resolved !== null && !isNaN(Number(resolved))) {
        leftValue = Number(resolved);
      }
    }
  }

  // Resolve right operand
  const rightLiteral = extractLiteralValue(right);
  if (typeof rightLiteral === 'number') {
    rightValue = rightLiteral;
  } else if (t.isIdentifier(right)) {
    // Try to resolve as imported constant first if context is available
    if (context) {
      const importedConstant = resolveImportedConstant(right.name, context);
      if (importedConstant !== null && typeof importedConstant === 'number') {
        rightValue = importedConstant;
      }
    }

    // Fall back to local variable resolution
    if (rightValue === null) {
      const resolved = resolveVariable(right.name, path);
      if (resolved !== null && !isNaN(Number(resolved))) {
        rightValue = Number(resolved);
      }
    }
  }

  // Perform the operation if both operands are resolved
  if (leftValue !== null && rightValue !== null) {
    switch (operator) {
      case '+':
        return (leftValue + rightValue).toString();
      case '-':
        return (leftValue - rightValue).toString();
      case '*':
        return (leftValue * rightValue).toString();
      case '/':
        return (leftValue / rightValue).toString();
      default:
        return null;
    }
  }

  return null;
}

export function resolveFunctionCall(
  callExpr: t.CallExpression,
  context: CssProcessingContext,
  dev: boolean = false,
): string | null {
  // First try to resolve theme color call expressions
  const themeColorResult = resolveThemeColorCallExpression(
    callExpr,
    context,
    dev,
  );
  if (themeColorResult !== null) return themeColorResult;

  if (!t.isIdentifier(callExpr.callee)) return null;

  const functionName = callExpr.callee.name;
  const functionFilePath = context.importedFunctions.get(functionName);

  if (!functionFilePath) return null;

  // Load the function (validation happens here, throws on error)
  const compiledFn = context.loadExternalFunction(
    context.fs,
    functionFilePath,
    functionName,
    context.compiledFunctions,
    context.debug,
  );
  const args = callExpr.arguments;

  // Mark this function as used
  context.usedFunctions.add(functionName);

  // TypeScript will handle argument count validation, so we don't need runtime checks

  if (compiledFn.type === 'positional') {
    // Handle positional arguments - need to map to parameter names
    const argValues: Record<string, string | number | boolean | undefined> = {};

    // Get parameter names from the compiled function
    const paramNames = getParameterNames(compiledFn);

    // Initialize all parameters to undefined first
    for (const [index] of compiledFn.args.entries()) {
      const paramName = paramNames[index];
      if (paramName) {
        argValues[paramName] = undefined;
      }
    }

    // Then set the provided arguments
    for (const [index, arg] of args.entries()) {
      const paramName = paramNames[index];
      if (paramName && t.isExpression(arg)) {
        const { value, resolved } = extractArgumentValue(arg, context.path);
        if (resolved && value !== null) {
          argValues[paramName] = value;
        }
      }
    }

    return evaluateOutput(compiledFn.output, argValues);
  } else {
    // Handle destructured object arguments
    if (args.length === 1 && t.isObjectExpression(args[0])) {
      const argValues: Record<string, string | number | boolean | undefined> =
        {};

      // Add default values first
      for (const [name, argDef] of Object.entries(compiledFn.args)) {
        if (argDef.defaultValue !== undefined) {
          argValues[name] = argDef.defaultValue;
        }
      }

      // Override with provided values
      for (const prop of args[0].properties) {
        if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
          const key = prop.key.name;
          const value = extractLiteralValue(prop.value);
          if (value !== null) {
            argValues[key] = value;
          }
        }
      }

      return evaluateOutput(compiledFn.output, argValues);
    }
  }

  return null;
}

function getParameterNames(compiledFn: {
  type: 'positional';
  args: FunctionArg[];
}): string[] {
  return compiledFn.args.map((arg) => arg.name ?? 'unknown');
}
