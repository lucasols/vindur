import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import generate from '@babel/generator';
import type { VindurPluginState } from '../babel-plugin';
import { isDynamicColorSetPropsCall } from './jsx-utils';
import { filterWithNarrowing } from '../utils';

export function handleJsxStyledComponent(
  path: NodePath<t.JSXElement>,
  context: { state: VindurPluginState },
): boolean {
  if (!t.isJSXIdentifier(path.node.openingElement.name)) {
    return false;
  }

  const elementName = path.node.openingElement.name.name;
  const styledInfo = context.state.styledComponents.get(elementName);

  if (!styledInfo) return false;

  // Skip transformation for exported styled components - they remain as component references
  if (styledInfo.isExported) return false;

  // Check if this element has already been transformed (by CSS prop handler)
  // If the element name is not the styled component name anymore, it was already processed
  if (
    !t.isJSXIdentifier(path.node.openingElement.name)
    || elementName !== path.node.openingElement.name.name
  ) {
    return false;
  }

  // Replace the styled component with the actual HTML element
  path.node.openingElement.name = t.jsxIdentifier(styledInfo.element);
  if (path.node.closingElement) {
    path.node.closingElement.name = t.jsxIdentifier(styledInfo.element);
  }

  // Check if dynamic colors have already been processed by looking for _sp spread calls
  const attributes = path.node.openingElement.attributes;
  const hasDynamicColorSpread = attributes.some(
    (attr) =>
      t.isJSXSpreadAttribute(attr)
      && t.isCallExpression(attr.argument)
      && t.isMemberExpression(attr.argument.callee)
      && t.isIdentifier(attr.argument.callee.property)
      && attr.argument.callee.property.name === '_sp',
  );

  // Only run className merging if dynamic colors haven't already handled it
  if (!hasDynamicColorSpread) {
    handleJsxClassNameMerging(path, styledInfo, context);
  }

  return true;
}

function handleJsxClassNameMerging(
  path: NodePath<t.JSXElement>,
  styledInfo: { element: string; className: string; isExported: boolean },
  context: { state: VindurPluginState },
): void {
  // Check for spread attributes
  const attributes = path.node.openingElement.attributes;
  const spreadAttrs = filterWithNarrowing(attributes, (attr) =>
    t.isJSXSpreadAttribute(attr) ? attr : false,
  );

  // Validate spread expressions - only allow simple identifiers or dynamic color setProps calls
  for (const attr of spreadAttrs) {
    if (
      !t.isIdentifier(attr.argument)
      && !isDynamicColorSetPropsCall(attr.argument, context)
    ) {
      const expressionCode = generate(attr.argument).code;
      throw new Error(
        `Unsupported spread expression "${expressionCode}" used in vindur styled component. Only references to variables are allowed in spread expressions. Extract them to a variable and use that variable in the spread expression.`,
      );
    }
  }

  const classNameAttrs = filterWithNarrowing(attributes, (attr) =>
    t.isJSXAttribute(attr)
    && t.isJSXIdentifier(attr.name)
    && attr.name.name === 'className'
      ? attr
      : false,
  );
  const existingClassNameAttr = classNameAttrs[classNameAttrs.length - 1]; // Get the last className attr

  if (spreadAttrs.length > 0) {
    handleClassNameWithSpreads(
      attributes,
      spreadAttrs,
      existingClassNameAttr,
      classNameAttrs,
      styledInfo,
      context,
    );
  } else {
    handleClassNameWithoutSpreads(
      attributes,
      existingClassNameAttr,
      styledInfo,
    );
  }
}

function handleClassNameWithSpreads(
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  spreadAttrs: t.JSXSpreadAttribute[],
  existingClassNameAttr: t.JSXAttribute | undefined,
  classNameAttrs: t.JSXAttribute[],
  styledInfo: { element: string; className: string; isExported: boolean },
  context: { state: VindurPluginState },
): void {
  // Check if any spread is a dynamic color setProps call that already includes className
  const hasDynamicColorSetPropsWithClassName = spreadAttrs.some((attr) => {
    if (isDynamicColorSetPropsCall(attr.argument, context)) {
      // Check if the setProps call has a className in its second argument
      if (
        t.isCallExpression(attr.argument)
        && attr.argument.arguments.length > 1
      ) {
        const secondArg = attr.argument.arguments[1];
        if (t.isObjectExpression(secondArg)) {
          return secondArg.properties.some(
            (prop) =>
              t.isObjectProperty(prop)
              && t.isIdentifier(prop.key)
              && prop.key.name === 'className',
          );
        }
      }
    }
    return false;
  });

  // If there's already a setProps with className, don't modify anything
  if (hasDynamicColorSetPropsWithClassName) return;
  // Find the last spread index
  const lastSpreadIndex = Math.max(
    ...spreadAttrs.map((attr) => attributes.indexOf(attr)),
  );

  // Only apply mergeClassNames logic to the final className attribute
  if (existingClassNameAttr) {
    const finalClassNameIndex = attributes.indexOf(existingClassNameAttr);
    const hasSpreadsAfterFinalClassName = lastSpreadIndex > finalClassNameIndex;
    const hasMultipleClassNames = classNameAttrs.length > 1;

    if (
      !hasSpreadsAfterFinalClassName
      && t.isStringLiteral(existingClassNameAttr.value)
    ) {
      // className comes after all spreads - static merge, no mergeClassNames needed
      // Remove any previous className attributes since the final one overrides
      if (hasMultipleClassNames) {
        const previousClassNameAttrs = classNameAttrs.slice(0, -1); // All except the last one
        for (const prevAttr of previousClassNameAttrs) {
          const index = attributes.indexOf(prevAttr);
          if (index !== -1) {
            attributes.splice(index, 1);
          }
        }
      }
      existingClassNameAttr.value.value = `${styledInfo.className} ${existingClassNameAttr.value.value}`;
    } else {
      // className comes before spreads or among spreads - needs mergeClassNames
      // Move the className to after the spreads for proper React precedence
      createMergeWithSpreadCall(
        existingClassNameAttr,
        spreadAttrs,
        styledInfo,
        context,
        attributes,
      );
    }
  } else {
    // No existing className - add one with mergeClassNames
    createMergeWithSpreadCall(
      undefined,
      spreadAttrs,
      styledInfo,
      context,
      attributes,
    );
  }
}

function handleClassNameWithoutSpreads(
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  existingClassNameAttr: t.JSXAttribute | undefined,
  styledInfo: { element: string; className: string; isExported: boolean },
): void {
  if (existingClassNameAttr) {
    // Merge with existing className
    if (t.isStringLiteral(existingClassNameAttr.value)) {
      // If it's a string literal, concatenate
      existingClassNameAttr.value.value = `${styledInfo.className} ${existingClassNameAttr.value.value}`;
    } else if (t.isJSXExpressionContainer(existingClassNameAttr.value)) {
      // If it's an expression, create a template literal
      existingClassNameAttr.value = t.jsxExpressionContainer(
        t.templateLiteral(
          [
            t.templateElement(
              {
                cooked: `${styledInfo.className} `,
                raw: `${styledInfo.className} `,
              },
              false,
            ),
            t.templateElement({ cooked: '', raw: '' }, true),
          ],
          [
            t.isJSXEmptyExpression(existingClassNameAttr.value.expression) ?
              t.stringLiteral('')
            : existingClassNameAttr.value.expression,
          ],
        ),
      );
    }
  } else {
    // Add new className attribute
    attributes.push(
      t.jsxAttribute(
        t.jsxIdentifier('className'),
        t.stringLiteral(styledInfo.className),
      ),
    );
  }
}

function createMergeWithSpreadCall(
  existingClassNameAttr: t.JSXAttribute | undefined,
  spreadAttrs: t.JSXSpreadAttribute[],
  styledInfo: { element: string; className: string; isExported: boolean },
  context: { state: VindurPluginState },
  attributes?: (t.JSXAttribute | t.JSXSpreadAttribute)[],
): void {
  context.state.vindurImports.add('mergeClassNames');

  // Build the spread props array
  const spreadPropsArray = spreadAttrs.map((attr) => attr.argument);

  if (existingClassNameAttr && attributes) {
    // For className before spreads case, we need to position it after spreads
    // but use mergeClassNames to handle potential conflicts

    // Find the position of the last spread attribute
    const lastSpreadIndex = Math.max(
      ...spreadAttrs.map((attr) => attributes.indexOf(attr)),
    );

    // Remove the existing className attribute
    const classNameIndex = attributes.indexOf(existingClassNameAttr);
    attributes.splice(classNameIndex, 1);

    // Create the mergeClassNames call based on SPEC format
    let mergeCall: t.CallExpression;
    if (t.isStringLiteral(existingClassNameAttr.value)) {
      // For string literals: `mergeClassNames(["className", ...spreads], styledClassName)`
      mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
        t.arrayExpression([
          t.stringLiteral(existingClassNameAttr.value.value),
          ...spreadPropsArray,
        ]),
        t.stringLiteral(styledInfo.className),
      ]);
    } else {
      // For expression className
      const classNameExpr =
        t.isJSXExpressionContainer(existingClassNameAttr.value) ?
          existingClassNameAttr.value.expression
        : t.stringLiteral('');

      mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
        t.arrayExpression([
          t.isJSXEmptyExpression(classNameExpr) ?
            t.stringLiteral('')
          : classNameExpr,
          ...spreadPropsArray,
        ]),
        t.stringLiteral(styledInfo.className),
      ]);
    }

    // Add the new className attribute after the last spread
    // Adjust the index if we removed a className before the last spread
    const insertIndex =
      classNameIndex < lastSpreadIndex ? lastSpreadIndex : lastSpreadIndex + 1;
    attributes.splice(
      insertIndex,
      0,
      t.jsxAttribute(
        t.jsxIdentifier('className'),
        t.jsxExpressionContainer(mergeCall),
      ),
    );
  } else if (existingClassNameAttr) {
    // Simple case - just replace the existing className
    let mergeCall: t.CallExpression;
    if (t.isStringLiteral(existingClassNameAttr.value)) {
      mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
        t.arrayExpression([
          t.stringLiteral(existingClassNameAttr.value.value),
          ...spreadPropsArray,
        ]),
        t.stringLiteral(styledInfo.className),
      ]);
    } else {
      const classNameExpr =
        t.isJSXExpressionContainer(existingClassNameAttr.value) ?
          existingClassNameAttr.value.expression
        : t.stringLiteral('');

      mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
        t.arrayExpression([
          t.isJSXEmptyExpression(classNameExpr) ?
            t.stringLiteral('')
          : classNameExpr,
          ...spreadPropsArray,
        ]),
        t.stringLiteral(styledInfo.className),
      ]);
    }

    existingClassNameAttr.value = t.jsxExpressionContainer(mergeCall);
  } else if (attributes) {
    // No existing className - add one with mergeClassNames after spreads
    const mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
      t.arrayExpression(spreadPropsArray),
      t.stringLiteral(styledInfo.className),
    ]);

    attributes.push(
      t.jsxAttribute(
        t.jsxIdentifier('className'),
        t.jsxExpressionContainer(mergeCall),
      ),
    );
  }
}
