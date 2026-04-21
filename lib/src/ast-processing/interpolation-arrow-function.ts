import { types as t } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import { TransformError } from '../custom-errors';

export function processArrowFunctionExpression(
  expression: t.ArrowFunctionExpression,
  variableName: string | undefined,
  tagType: string,
): string {
  if (
    expression.params.length === 0
    && t.isIdentifier(expression.body)
    && !expression.async
  ) {
    const componentName = expression.body.name;
    return `__FORWARD_REF__${componentName}__`;
  }

  const varContext = variableName ? `... ${variableName} = ${tagType}` : tagType;
  throw new TransformError(
    `Invalid arrow function in interpolation at \`${varContext}\`. Only simple forward references like \${() => Component} are supported`,
    notNullish(expression.loc),
  );
}
