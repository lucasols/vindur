import { types as t } from '@babel/core';
import type { VindurPluginState } from '../babel-plugin';

// Helper function to check if an expression is a dynamic color setProps call
export function isDynamicColorSetPropsCall(
  expr: t.Expression,
  context: { state: VindurPluginState },
): boolean {
  if (
    t.isCallExpression(expr)
    && t.isMemberExpression(expr.callee)
    && t.isIdentifier(expr.callee.object)
    && t.isIdentifier(expr.callee.property)
    && (expr.callee.property.name === 'setProps'
      || expr.callee.property.name === '_sp')
  ) {
    const objectName = expr.callee.object.name;
    return Boolean(context.state.dynamicColors?.has(objectName));
  }
  return false;
}