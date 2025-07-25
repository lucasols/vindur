import { types as t } from '@babel/core';

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

export function extractArgumentValue(arg: t.Expression): { value: string | number | boolean | null; resolved: boolean } {
  const value = extractLiteralValue(arg);
  return { value, resolved: value !== null };
}