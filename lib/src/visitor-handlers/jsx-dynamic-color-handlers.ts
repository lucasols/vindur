import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import generate from '@babel/generator';
import { handleDynamicColorSetCall } from './jsx-dynamic-color-set-call-handler';
import { filterWithNarrowing, findWithNarrowing } from '../utils';
import {
  type DynamicColorContext,
  type OverrideAttributes,
  findAndRemoveDynamicColorAttr,
  findOverrideAttributes,
  handleArrayExpression,
} from './jsx-utils';


function validateDynamicColorExpression(expression: t.Expression): void {
  if (
    t.isConditionalExpression(expression)
    || t.isLogicalExpression(expression)
  ) {
    let suggestedFix = '';
    if (t.isConditionalExpression(expression)) {
      const test = generate(expression.test).code;
      const consequent = generate(expression.consequent).code;
      const alternate = generate(expression.alternate).code;
      suggestedFix = `color.set(${test} ? ${consequent.replace(/\.set\([^)]+\)/, '').replace(/color/, "'#ff6b6b'")} : ${alternate === 'null' || alternate === 'undefined' ? alternate : "'#ff6b6b'"})`;
    } else if (
      t.isLogicalExpression(expression)
      && expression.operator === '&&'
    ) {
      const left = generate(expression.left).code;
      const right = generate(expression.right).code;
      suggestedFix = `color.set(${left} ? ${right.replace(/\.set\([^)]+\)/, '').replace(/color/, "'#ff6b6b'")} : null)`;
    }
    throw new Error(
      `Conditional dynamicColor is not supported. Use condition inside the set function instead: ${suggestedFix}`,
    );
  }
}

function handleCallExpression(
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
      throw new Error(`Unknown dynamic color variable "${colorName}"`);
    }

    const colorArg = expr.arguments[0];
    if (!colorArg || !t.isExpression(colorArg)) {
      throw new Error('color.set() must have a valid color argument');
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

export function handleJsxDynamicColorProp(
  path: NodePath<t.JSXElement>,
  context: DynamicColorContext,
): boolean {
  const attributes = path.node.openingElement.attributes;
  const dynamicColorResult = findAndRemoveDynamicColorAttr(attributes);
  
  if (!dynamicColorResult) return false;
  
  const { attr: dynamicColorAttr, index: dynamicColorAttrIndex } = dynamicColorResult;
  const overrides = findOverrideAttributes(attributes, dynamicColorAttr);

  if (
    !dynamicColorAttr.value
    || !t.isJSXExpressionContainer(dynamicColorAttr.value)
  ) {
    throw new Error('dynamicColor prop must have a value');
  }

  const expr = dynamicColorAttr.value.expression;
  if (!t.isExpression(expr)) {
    throw new Error('dynamicColor expression must be a valid expression');
  }
  
  validateDynamicColorExpression(expr);

  if (t.isCallExpression(expr)) {
    return handleCallExpression(expr, path, overrides, context);
  }

function handleSingleIdentifier(
  expression: t.Identifier,
  elementPath: NodePath<t.JSXElement>,
  attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  colorAttrIndex: number,
  ctx: DynamicColorContext,
): void {
  const dynamicColorId = ctx.state.dynamicColors?.get(expression.name);
  if (!dynamicColorId) {
    throw new Error(`Unknown dynamic color variable "${expression.name}"`);
  }

  let targetClassName: string | undefined;
  if (t.isJSXIdentifier(elementPath.node.openingElement.name)) {
    const elementName = elementPath.node.openingElement.name.name;
    const styledInfo = ctx.state.styledComponents.get(elementName);
    if (styledInfo) {
      targetClassName = styledInfo.className;
    }
  }

  const spreadAttrs = filterWithNarrowing(attrs, (attr) =>
    t.isJSXSpreadAttribute(attr) ? attr : false,
  );

  const remainingAttrs = filterWithNarrowing(attrs, (attr) =>
    t.isJSXAttribute(attr) ? attr : false,
  );

  const classNameAttr = findWithNarrowing(remainingAttrs, (attr) =>
    t.isJSXIdentifier(attr.name) && attr.name.name === 'className' ? attr : false,
  ) || false;

  const styleAttr = findWithNarrowing(remainingAttrs, (attr) =>
    t.isJSXIdentifier(attr.name) && attr.name.name === 'style' ? attr : false,
  ) || false;

  const setPropsArgs: t.Expression[] = [t.stringLiteral('#ff6b6b')];
  const objectProperties: t.ObjectProperty[] = [];

  handleClassNameForSingleColor({
    targetClassName,
    classNameAttr,
    spreadAttrs,
    attributes: attrs,
    objectProperties,
    context: ctx,
  });

  handleStyleForSingleColor({
    styleAttr,
    spreadAttrs,
    attributes: attrs,
    objectProperties,
    context: ctx,
  });

  if (objectProperties.length > 0) {
    setPropsArgs.push(t.objectExpression(objectProperties));
  }

  const setPropsCall = t.callExpression(
    t.memberExpression(t.identifier(expression.name), t.identifier('_sp')),
    setPropsArgs,
  );

  attrs.splice(
    colorAttrIndex,
    0,
    t.jsxSpreadAttribute(setPropsCall),
  );
}

function handleClassNameForSingleColor(params: {
  targetClassName: string | undefined;
  classNameAttr: t.JSXAttribute | false;
  spreadAttrs: t.JSXSpreadAttribute[];
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[];
  objectProperties: t.ObjectProperty[];
  context: DynamicColorContext;
}): void {
  const { targetClassName, classNameAttr, spreadAttrs, attributes: attrs, objectProperties, context: ctx } = params;
  
  if (!targetClassName && !classNameAttr) return;

  const classNameIndex = classNameAttr ? attrs.indexOf(classNameAttr) : -1;
  const lastSpreadIndex = spreadAttrs.length > 0 ?
    Math.max(...spreadAttrs.map((attr) => attrs.indexOf(attr))) : -1;
  
  const needsMerging = spreadAttrs.length > 0 &&
    ((classNameIndex !== -1 && classNameIndex <= lastSpreadIndex) ||
     (targetClassName && classNameIndex === -1));

  if (needsMerging) {
    handleClassNameWithMerging({ targetClassName, classNameAttr, spreadAttrs, attributes: attrs, objectProperties, context: ctx });
  } else {
    handleSimpleClassName({ targetClassName, classNameAttr, attributes: attrs, objectProperties });
  }
}

function handleClassNameWithMerging(params: {
  targetClassName: string | undefined;
  classNameAttr: t.JSXAttribute | false;
  spreadAttrs: t.JSXSpreadAttribute[];
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[];
  objectProperties: t.ObjectProperty[];
  context: DynamicColorContext;
}): void {
  const { targetClassName, classNameAttr, spreadAttrs, attributes: attrs, objectProperties, context: ctx } = params;
  
  if (!classNameAttr) {
    // Handle the case where we have targetClassName but no explicit className attr
    if (targetClassName) {
      ctx.state.vindurImports.add('mergeClassNames');
      const mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
        t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
        t.stringLiteral(targetClassName),
      ]);
      objectProperties.push(
        t.objectProperty(t.identifier('className'), mergeCall),
      );
    }
    return;
  }
  
  let finalClassName = targetClassName || '';
  if (t.isJSXExpressionContainer(classNameAttr.value) && !t.isJSXEmptyExpression(classNameAttr.value.expression)) {
    const classNameExpr = classNameAttr.value.expression;
    const mergeArgs = [...spreadAttrs.map((attr) => attr.argument)];

    if (targetClassName) {
      mergeArgs.push(t.stringLiteral(targetClassName));
      mergeArgs.push(classNameExpr);
    } else {
      mergeArgs.push(classNameExpr);
    }

    ctx.state.vindurImports.add('mergeClassNames');
    const mergeCall = t.callExpression(
      t.identifier('mergeClassNames'),
      [
        t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
        ...mergeArgs.slice(spreadAttrs.length),
      ],
    );
    objectProperties.push(
      t.objectProperty(t.identifier('className'), mergeCall),
    );
  } else if (t.isStringLiteral(classNameAttr.value)) {
    if (targetClassName) {
      finalClassName = `${targetClassName} ${classNameAttr.value.value}`;
    } else {
      finalClassName = classNameAttr.value.value;
    }
    ctx.state.vindurImports.add('mergeClassNames');
    const mergeCall = t.callExpression(
      t.identifier('mergeClassNames'),
      [
        t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
        t.stringLiteral(finalClassName),
      ],
    );
    objectProperties.push(
      t.objectProperty(t.identifier('className'), mergeCall),
    );
  }
  const currentClassNameIndex = attrs.indexOf(classNameAttr);
  attrs.splice(currentClassNameIndex, 1);
}

function handleSimpleClassName(params: {
  targetClassName: string | undefined;
  classNameAttr: t.JSXAttribute | false;
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[];
  objectProperties: t.ObjectProperty[];
}): void {
  const { targetClassName, classNameAttr, attributes: attrs, objectProperties } = params;
  
  let finalClassName = targetClassName || '';
  if (classNameAttr) {
    if (
      t.isJSXExpressionContainer(classNameAttr.value)
      && !t.isJSXEmptyExpression(classNameAttr.value.expression)
    ) {
      if (targetClassName) {
        const combinedClassName = t.templateLiteral(
          [
            t.templateElement({
              raw: `${targetClassName} `,
              cooked: `${targetClassName} `,
            }),
            t.templateElement({ raw: '', cooked: '' }, true),
          ],
          [classNameAttr.value.expression],
        );
        objectProperties.push(
          t.objectProperty(t.identifier('className'), combinedClassName),
        );
      } else {
        objectProperties.push(
          t.objectProperty(
            t.identifier('className'),
            classNameAttr.value.expression,
          ),
        );
      }
    } else if (t.isStringLiteral(classNameAttr.value)) {
      if (targetClassName) {
        finalClassName = `${targetClassName} ${classNameAttr.value.value}`;
      } else {
        finalClassName = classNameAttr.value.value;
      }
      objectProperties.push(
        t.objectProperty(
          t.identifier('className'),
          t.stringLiteral(finalClassName),
        ),
      );
    }
    const currentClassNameIndex = attrs.indexOf(classNameAttr);
    attrs.splice(currentClassNameIndex, 1);
  } else if (targetClassName) {
    objectProperties.push(
      t.objectProperty(
        t.identifier('className'),
        t.stringLiteral(targetClassName),
      ),
    );
  }
}

function handleStyleForSingleColor(params: {
  styleAttr: t.JSXAttribute | false;
  spreadAttrs: t.JSXSpreadAttribute[];
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[];
  objectProperties: t.ObjectProperty[];
  context: DynamicColorContext;
}): void {
  const { styleAttr, spreadAttrs, attributes: attrs, objectProperties, context: ctx } = params;
  
  const firstSpreadIndex = spreadAttrs.length > 0 && spreadAttrs[0] ?
    attrs.indexOf(spreadAttrs[0]) : -1;

  if (spreadAttrs.length > 0 && !styleAttr) {
    ctx.state.vindurImports.add('mergeStyles');
    const mergeStylesCall = t.callExpression(t.identifier('mergeStyles'), [
      t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
    ]);
    objectProperties.push(
      t.objectProperty(t.identifier('style'), mergeStylesCall),
    );
  } else if (styleAttr) {
    const styleIndex = attrs.indexOf(styleAttr);
    const styleNeedsMerging = spreadAttrs.length > 0 &&
      styleIndex !== -1 && styleIndex < firstSpreadIndex;

    if (styleNeedsMerging) {
      ctx.state.vindurImports.add('mergeStyles');
      let styleValue;
      if (
        t.isJSXExpressionContainer(styleAttr.value)
        && !t.isJSXEmptyExpression(styleAttr.value.expression)
      ) {
        styleValue = styleAttr.value.expression;
      } else if (t.isStringLiteral(styleAttr.value)) {
        styleValue = styleAttr.value;
      } else {
        styleValue = t.objectExpression([]);
      }

      const mergeStylesCall = t.callExpression(t.identifier('mergeStyles'), [
        t.arrayExpression([
          ...spreadAttrs.map((attr) => attr.argument),
          styleValue,
        ]),
      ]);
      objectProperties.push(
        t.objectProperty(t.identifier('style'), mergeStylesCall),
      );
    } else {
      let styleValue;
      if (
        t.isJSXExpressionContainer(styleAttr.value)
        && !t.isJSXEmptyExpression(styleAttr.value.expression)
      ) {
        styleValue = styleAttr.value.expression;
      } else if (t.isStringLiteral(styleAttr.value)) {
        styleValue = styleAttr.value;
      } else {
        styleValue = t.objectExpression([]);
      }

      objectProperties.push(
        t.objectProperty(t.identifier('style'), styleValue),
      );
    }

    const currentStyleIndex = attrs.indexOf(styleAttr);
    attrs.splice(currentStyleIndex, 1);
  }
}

  if (t.isIdentifier(expr)) {
    handleSingleIdentifier(expr, path, attributes, dynamicColorAttrIndex, context);

  } else if (t.isArrayExpression(expr)) {
    handleArrayExpression(expr, path, attributes, dynamicColorAttrIndex, context);
  } else {
    throw new Error(
      'dynamicColor prop must be a single identifier or array of identifiers',
    );
  }

  return true;
}
