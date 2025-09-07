import { TransformError } from '../custom-errors';
import { notNullish } from '@ls-stack/utils/assertions';
import { types as t } from '@babel/core';
import type { VindurPluginState } from '../babel-plugin';

export function collectAndRemoveStyleFlagClasses(
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  styleFlags: Array<{
    propName: string;
    hashedClassName: string;
    type: 'boolean' | 'string-union';
    unionValues?: string[];
  }>,
  state: VindurPluginState,
): { staticFlagClasses: string[]; dynamicFlagExprs: t.Expression[] } {
  const staticFlagClasses: string[] = [];
  const dynamicFlagExprs: t.Expression[] = [];

  function findAttrIndex(name: string): number {
    return attributes.findIndex(
      (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === name,
    );
  }

  for (const flag of styleFlags) {
    const idx = findAttrIndex(flag.propName);
    if (idx === -1) continue;
    const attr = attributes[idx];
    attributes.splice(idx, 1);
    if (!t.isJSXAttribute(attr)) continue;

    const val = attr.value;
    if (flag.type === 'boolean') {
      if (val == null) {
        staticFlagClasses.push(flag.hashedClassName);
      } else if (t.isJSXExpressionContainer(val)) {
        const exprNode = val.expression;
        if (t.isBooleanLiteral(exprNode)) {
          if (exprNode.value) staticFlagClasses.push(flag.hashedClassName);
        } else if (t.isExpression(exprNode)) {
          state.vindurImports.add('cx');
          dynamicFlagExprs.push(
            t.logicalExpression('&&', exprNode, t.stringLiteral(flag.hashedClassName)),
          );
        }
      } else if (t.isStringLiteral(val)) {
        state.vindurImports.add('cx');
        dynamicFlagExprs.push(
          t.logicalExpression('&&', t.stringLiteral(val.value), t.stringLiteral(flag.hashedClassName)),
        );
      }
    } else {
      if (val == null) {
        throw new TransformError(
          `Style flag "${flag.propName}" requires a value`,
          notNullish(attr.loc),
        );
      } else if (t.isStringLiteral(val)) {
        staticFlagClasses.push(`${flag.hashedClassName}-${val.value}`);
      } else if (t.isJSXExpressionContainer(val)) {
        const exprNode = val.expression;
        if (t.isStringLiteral(exprNode)) {
          staticFlagClasses.push(`${flag.hashedClassName}-${exprNode.value}`);
        } else if (t.isExpression(exprNode)) {
          state.vindurImports.add('cx');
          dynamicFlagExprs.push(
            t.logicalExpression(
              '&&',
              exprNode,
              t.templateLiteral(
                [
                  t.templateElement({ cooked: `${flag.hashedClassName}-`, raw: `${flag.hashedClassName}-` }, false),
                  t.templateElement({ cooked: '', raw: '' }, true),
                ],
                [exprNode],
              ),
            ),
          );
        }
      }
    }
  }

  return { staticFlagClasses, dynamicFlagExprs };
}

export function buildCxWithFlags(
  base: t.Expression,
  staticFlagClasses: string[],
  dynamicFlagExprs: t.Expression[],
  state: VindurPluginState,
): t.Expression | null {
  const args: t.Expression[] = [base];
  for (const s of staticFlagClasses) args.push(t.stringLiteral(s));
  for (const d of dynamicFlagExprs) args.push(d);

  if (args.length > 1) {
    state.vindurImports.add('cx');
    return t.callExpression(t.identifier('cx'), args);
  }
  return null;
}
