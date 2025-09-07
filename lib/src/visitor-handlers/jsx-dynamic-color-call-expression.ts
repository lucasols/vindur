import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import { TransformError } from '../custom-errors';
import { handleDynamicColorSetCall } from './jsx-dynamic-color-set-call-handler';
import type { DynamicColorContext, OverrideAttributes } from './jsx-utils';

export function handleCallExpression(
  expr: t.CallExpression,
  path: NodePath<t.JSXElement>,
  overrides: OverrideAttributes,
  context: DynamicColorContext,
): boolean {
  if (
    t.isMemberExpression(expr.callee)
    && t.isIdentifier(expr.callee.object)
    && t.isIdentifier(expr.callee.property)
    && expr.callee.property.name === 'set'
  ) {
    const colorName = expr.callee.object.name;
    const dynamicColorId = context.state.dynamicColors?.get(colorName);
    if (!dynamicColorId) {
      throw new TransformError(
        `Unknown dynamic color variable "${colorName}"`,
        notNullish(expr.callee.loc),
      );
    }

    const colorArg = expr.arguments[0];
    if (!colorArg || !t.isExpression(colorArg)) {
      throw new TransformError(
        'color.set() must have a valid color argument',
        notNullish(expr.loc),
      );
    }

    handleDynamicColorSetCall(
      path,
      colorName,
      colorArg,
      {
        classNameOverride: overrides.classNameOverride || undefined,
        styleOverride: overrides.styleOverride || undefined,
      },
      context,
    );
    return true;
  }
  return false;
}
