import { types as t } from '@babel/core';
import { generate } from '@babel/generator';
import { notNullish } from '@ls-stack/utils/assertions';
import { TransformError } from '../custom-errors';

// Top-level regexes to avoid creating new RegExp objects on each function call
const SET_REPLACE_REGEX = /\.set\([^)]+\)/;
const COLOR_REPLACE_REGEX = /color/;

export function validateDynamicColorExpression(expression: t.Expression): void {
  if (
    t.isConditionalExpression(expression)
    || t.isLogicalExpression(expression)
  ) {
    let suggestedFix = '';
    if (t.isConditionalExpression(expression)) {
      const test = generate(expression.test).code;
      const consequent = generate(expression.consequent).code;
      const alternate = generate(expression.alternate).code;
      suggestedFix = `color.set(${test} ? ${consequent.replace(SET_REPLACE_REGEX, '').replace(COLOR_REPLACE_REGEX, "'#ff6b6b'")} : ${alternate === 'null' || alternate === 'undefined' ? alternate : "'#ff6b6b'"})`;
    } else if (
      t.isLogicalExpression(expression)
      && expression.operator === '&&'
    ) {
      const left = generate(expression.left).code;
      const right = generate(expression.right).code;
      suggestedFix = `color.set(${left} ? ${right.replace(SET_REPLACE_REGEX, '').replace(COLOR_REPLACE_REGEX, "'#ff6b6b'")} : null)`;
    }
    throw new TransformError(
      `Conditional dynamicColor is not supported. Use condition inside the set function instead: ${suggestedFix}`,
      notNullish(expression.loc),
    );
  }
}
