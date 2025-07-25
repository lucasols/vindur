import { types as t, type NodePath } from '@babel/core';

export type FunctionValueTypes = 'string' | 'number' | 'boolean';

// Utility functions for AST node handling
export function extractLiteralValue(node: t.Node): string | number | boolean | null {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isBooleanLiteral(node)) return node.value;
  return null;
}

export function getLiteralValueType(value: string | number | boolean | null): FunctionValueTypes {
  const type = typeof value;
  return (type === 'string' || type === 'number' || type === 'boolean') ? type : 'string';
}

export function isLiteralExpression(node: t.Node): node is t.StringLiteral | t.NumericLiteral | t.BooleanLiteral {
  return t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node);
}

export function extractArgumentValue(arg: t.Expression, path?: NodePath): { value: string | number | boolean | null; resolved: boolean } {
  // First try to get literal value
  const literalValue = extractLiteralValue(arg);
  if (literalValue !== null) {
    return { value: literalValue, resolved: true };
  }
  
  // If it's an identifier and we have a path, try to resolve the variable
  if (t.isIdentifier(arg) && path) {
    const resolvedValue = resolveVariable(arg.name, path);
    if (resolvedValue !== null) {
      // Try to parse as number if it looks like one
      const numValue = Number(resolvedValue);
      if (!isNaN(numValue) && isFinite(numValue)) {
        return { value: numValue, resolved: true };
      }
      return { value: resolvedValue, resolved: true };
    }
  }
  
  return { value: null, resolved: false };
}

// Variable resolution helper (moved from babel-plugin.ts to avoid circular dependency)
function resolveVariable(variableName: string, path: NodePath): string | null {
  // Find the variable declaration in the current scope or parent scopes
  const binding = path.scope.getBinding(variableName);

  if (!binding?.path) {
    return null;
  }

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

function resolveBinaryExpression(
  expr: t.BinaryExpression,
  path: NodePath,
): string | null {
  const { left, right, operator } = expr;

  let leftValue: number | null = null;
  let rightValue: number | null = null;

  // Resolve left operand
  const leftLiteral = extractLiteralValue(left);
  if (typeof leftLiteral === 'number') {
    leftValue = leftLiteral;
  } else if (t.isIdentifier(left)) {
    const resolved = resolveVariable(left.name, path);
    if (resolved !== null && !isNaN(Number(resolved))) {
      leftValue = Number(resolved);
    }
  }

  // Resolve right operand
  const rightLiteral = extractLiteralValue(right);
  if (typeof rightLiteral === 'number') {
    rightValue = rightLiteral;
  } else if (t.isIdentifier(right)) {
    const resolved = resolveVariable(right.name, path);
    if (resolved !== null && !isNaN(Number(resolved))) {
      rightValue = Number(resolved);
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