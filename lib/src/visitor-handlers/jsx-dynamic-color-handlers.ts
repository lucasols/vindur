import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import { TransformError } from '../custom-errors';
import { handleCallExpression } from './jsx-dynamic-color-call-expression';
import { handleSingleIdentifier } from './jsx-dynamic-color-single-identifier';
import { validateDynamicColorExpression } from './jsx-dynamic-color-validation';
import {
  type DynamicColorContext,
  findAndRemoveDynamicColorAttr,
  findOverrideAttributes,
  handleArrayExpression,
} from './jsx-utils';

export function handleJsxDynamicColorProp(
  path: NodePath<t.JSXElement>,
  context: DynamicColorContext,
): boolean {
  const attributes = path.node.openingElement.attributes;
  const dynamicColorResult = findAndRemoveDynamicColorAttr(attributes);

  if (!dynamicColorResult) return false;

  const { attr: dynamicColorAttr, index: dynamicColorAttrIndex } =
    dynamicColorResult;
  const overrides = findOverrideAttributes(attributes, dynamicColorAttr);

  if (
    !dynamicColorAttr.value
    || !t.isJSXExpressionContainer(dynamicColorAttr.value)
  ) {
    throw new TransformError(
      'dynamicColor prop must have a value',
      notNullish(dynamicColorAttr.loc),
    );
  }

  const expr = dynamicColorAttr.value.expression;
  if (!t.isExpression(expr)) {
    throw new TransformError(
      'dynamicColor expression must be a valid expression',
      notNullish(dynamicColorAttr.value.loc || dynamicColorAttr.loc),
    );
  }

  validateDynamicColorExpression(expr);

  if (t.isCallExpression(expr)) {
    return handleCallExpression(expr, path, overrides, context);
  }

  if (t.isIdentifier(expr)) {
    handleSingleIdentifier(
      expr,
      path,
      attributes,
      dynamicColorAttrIndex,
      context,
    );
  } else if (t.isArrayExpression(expr)) {
    handleArrayExpression(
      expr,
      path,
      attributes,
      dynamicColorAttrIndex,
      context,
    );
  } else {
    throw new TransformError(
      'dynamicColor prop must be a single identifier or array of identifiers',
      notNullish(expr.loc),
    );
  }

  return true;
}
