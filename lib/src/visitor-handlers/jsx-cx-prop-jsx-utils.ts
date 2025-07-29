import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import type { VindurPluginState } from '../babel-plugin';
import { findWithNarrowing } from '../utils';

export function addCxClassNameToJsx(
  path: NodePath<t.JSXElement>,
  cxCall: t.CallExpression,
  context: { state: VindurPluginState; dev: boolean },
  styledComponentName?: string,
): void {
  const attributes = path.node.openingElement.attributes;

  // Check for spread attributes
  const spreadAttrs = attributes.filter((attr) => t.isJSXSpreadAttribute(attr));

  // Find existing className attribute
  const classNameAttr = findWithNarrowing(attributes, (attr) => {
    if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'className') {
      return attr;
    }
    return false;
  });

  // Get styled component className if applicable
  const styledClassName =
    styledComponentName ?
      context.state.styledComponents.get(styledComponentName)?.className
    : undefined;

  if (spreadAttrs.length > 0) {
    // Use mergeClassNames for spread attributes
    context.state.vindurImports.add('mergeClassNames');

    const mergeArgs: t.Expression[] = [
      t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
    ];

    if (styledClassName) {
      // Add styled component className and cx call as concatenated string
      mergeArgs.push(
        t.binaryExpression('+', t.stringLiteral(`${styledClassName} `), cxCall),
      );
    } else {
      mergeArgs.push(cxCall);
    }

    const mergeCall = t.callExpression(
      t.identifier('mergeClassNames'),
      mergeArgs,
    );

    if (classNameAttr) {
      classNameAttr.value = t.jsxExpressionContainer(mergeCall);
    } else {
      const newClassNameAttr = t.jsxAttribute(
        t.jsxIdentifier('className'),
        t.jsxExpressionContainer(mergeCall),
      );
      attributes.push(newClassNameAttr);
    }
  } else if (classNameAttr) {
    // Merge with existing className
    if (t.isStringLiteral(classNameAttr.value)) {
      // Merge with string literal
      let existingValue = classNameAttr.value.value;
      if (styledClassName && !existingValue.includes(styledClassName)) {
        existingValue = `${existingValue} ${styledClassName}`;
      }

      // Use string concatenation for existing string literals
      classNameAttr.value = t.jsxExpressionContainer(
        t.binaryExpression('+', t.stringLiteral(`${existingValue} `), cxCall),
      );
    } else if (t.isJSXExpressionContainer(classNameAttr.value)) {
      // Merge with expression
      const existingExpr = classNameAttr.value.expression;
      const baseExpr =
        t.isJSXEmptyExpression(existingExpr) ?
          t.stringLiteral('')
        : existingExpr;

      if (styledClassName) {
        // Include styled component className
        if (context.dev) {
          // Dev mode: string concatenation with space
          classNameAttr.value = t.jsxExpressionContainer(
            t.binaryExpression(
              '+',
              t.binaryExpression(
                '+',
                t.stringLiteral(`${styledClassName} `),
                t.binaryExpression('+', baseExpr, t.stringLiteral(' ')),
              ),
              cxCall,
            ),
          );
        } else {
          // Production: template literal
          classNameAttr.value = t.jsxExpressionContainer(
            t.templateLiteral(
              [
                t.templateElement(
                  { raw: `${styledClassName} `, cooked: `${styledClassName} ` },
                  false,
                ),
                t.templateElement({ raw: ' ', cooked: ' ' }, false),
                t.templateElement({ raw: '', cooked: '' }, true),
              ],
              [baseExpr, cxCall],
            ),
          );
        }
      } else {
        classNameAttr.value = t.jsxExpressionContainer(
          t.binaryExpression(
            '+',
            t.binaryExpression('+', baseExpr, t.stringLiteral(' ')),
            cxCall,
          ),
        );
      }
    }
  } else {
    // Add new className attribute with cx call
    let classNameExpr: t.Expression;

    if (styledClassName) {
      // Use string concatenation for styled components
      classNameExpr = t.binaryExpression(
        '+',
        t.stringLiteral(`${styledClassName} `),
        cxCall,
      );
    } else {
      classNameExpr = cxCall;
    }

    const newClassNameAttr = t.jsxAttribute(
      t.jsxIdentifier('className'),
      t.jsxExpressionContainer(classNameExpr),
    );
    attributes.push(newClassNameAttr);
  }
}