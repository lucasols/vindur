import { types as t } from '@babel/core';

export function isLiteralExpression(
  node: t.Node,
): node is t.StringLiteral | t.NumericLiteral | t.BooleanLiteral {
  return (
    t.isStringLiteral(node)
    || t.isNumericLiteral(node)
    || t.isBooleanLiteral(node)
  );
}