import { TransformError } from '../custom-errors';
import type { NodePath } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import { types as t } from '@babel/core';
import type { VindurPluginState } from '../babel-plugin';
import { filterWithNarrowing, findWithNarrowing } from '../utils';

export type DynamicColorContext = { state: VindurPluginState };
export type OverrideAttributes = {
  classNameOverride: t.JSXAttribute | false;
  styleOverride: t.JSXAttribute | false;
};

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

export function findAndRemoveDynamicColorAttr(
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[],
): { attr: t.JSXAttribute; index: number } | null {
  const dynamicColorAttr = findWithNarrowing(attributes, (attr) =>
    (
      t.isJSXAttribute(attr)
      && t.isJSXIdentifier(attr.name)
      && attr.name.name === 'dynamicColor'
    ) ?
      attr
    : false,
  );

  if (!dynamicColorAttr) return null;

  const index = attributes.indexOf(dynamicColorAttr);
  attributes.splice(index, 1);

  return { attr: dynamicColorAttr, index };
}

export function findOverrideAttributes(
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  dynamicColorAttr: t.JSXAttribute,
): OverrideAttributes {
  const dynamicColorIndex = attributes.indexOf(dynamicColorAttr);

  // Find attributes that come AFTER the dynamicColor attribute
  const attributesAfterDynamicColor = attributes.slice(dynamicColorIndex + 1);

  // Find the LAST className and style attributes that come after dynamicColor
  let classNameOverride: t.JSXAttribute | false = false;
  let styleOverride: t.JSXAttribute | false = false;

  // Search from the end to get the last occurrence
  for (let i = attributesAfterDynamicColor.length - 1; i >= 0; i--) {
    const attr = attributesAfterDynamicColor[i];
    if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
      if (attr.name.name === 'className' && !classNameOverride) {
        classNameOverride = attr;
      }
      if (attr.name.name === 'style' && !styleOverride) {
        styleOverride = attr;
      }
    }
  }

  return { classNameOverride, styleOverride };
}

export function handleArrayExpression(
  arrayExpr: t.ArrayExpression,
  path: NodePath<t.JSXElement>,
  attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  dynamicColorAttrIndex: number,
  ctx: DynamicColorContext,
): void {
  const colorElements = filterWithNarrowing(arrayExpr.elements, (el) =>
    t.isIdentifier(el) ? el : false,
  );

  if (colorElements.length === 0) {
    throw new TransformError(
      'dynamicColor array must contain at least one color identifier',
      notNullish(arrayExpr.loc),
    );
  }

  // Validate all colors are known dynamic colors
  for (const colorEl of colorElements) {
    const dynamicColorId = ctx.state.dynamicColors?.get(colorEl.name);
    if (!dynamicColorId) {
      throw new TransformError(
        `Unknown dynamic color variable "${colorEl.name}"`,
        notNullish(colorEl.loc),
      );
    }
  }

  const spreadAttrs = filterWithNarrowing(attrs, (attr) =>
    t.isJSXSpreadAttribute(attr) ? attr : false,
  );

  const classNameAttr =
    findWithNarrowing(attrs, (attr) =>
      (
        t.isJSXAttribute(attr)
        && t.isJSXIdentifier(attr.name)
        && attr.name.name === 'className'
      ) ?
        attr
      : false,
    ) || false;

  const styleAttr =
    findWithNarrowing(attrs, (attr) =>
      (
        t.isJSXAttribute(attr)
        && t.isJSXIdentifier(attr.name)
        && attr.name.name === 'style'
      ) ?
        attr
      : false,
    ) || false;

  let targetClassName: string | undefined;
  if (t.isJSXIdentifier(path.node.openingElement.name)) {
    const elementName = path.node.openingElement.name.name;
    const styledInfo = ctx.state.styledComponents.get(elementName);
    if (styledInfo) {
      targetClassName = styledInfo.className;
    }
  }

  const nestedSetProps = buildNestedSetProps({
    colorElements,
    targetClassName,
    classNameAttr,
    styleAttr,
    spreadAttrs,
    attributes: attrs,
    context: ctx,
  });

  attrs.splice(dynamicColorAttrIndex, 0, t.jsxSpreadAttribute(nestedSetProps));
}

export function buildNestedSetProps(params: {
  colorElements: t.Identifier[];
  targetClassName: string | undefined;
  classNameAttr: t.JSXAttribute | false;
  styleAttr: t.JSXAttribute | false;
  spreadAttrs: t.JSXSpreadAttribute[];
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[];
  context: DynamicColorContext;
}): t.Expression {
  const {
    colorElements,
    targetClassName,
    classNameAttr,
    styleAttr,
    spreadAttrs,
    attributes,
    context,
  } = params;

  const lastColorElement = colorElements[colorElements.length - 1];
  if (!lastColorElement) {
    throw new TransformError(
      'No color elements found',
      notNullish(attributes[0]?.loc),
    );
  }
  let nestedSetProps: t.Expression = lastColorElement;

  for (let i = colorElements.length - 1; i >= 0; i--) {
    const colorIdentifier = colorElements[i];
    if (!colorIdentifier) continue;
    const setPropsArgs: t.Expression[] = [t.stringLiteral('#ff6b6b')];

    if (i === colorElements.length - 1) {
      const objectProperties = buildObjectPropertiesForArray({
        targetClassName,
        classNameAttr,
        styleAttr,
        spreadAttrs,
        attributes,
        context,
      });

      if (objectProperties.length > 0) {
        setPropsArgs.push(t.objectExpression(objectProperties));
      }
    } else if (i < colorElements.length - 1) {
      setPropsArgs.push(nestedSetProps);
    }

    nestedSetProps = t.callExpression(
      t.memberExpression(colorIdentifier, t.identifier('_sp')),
      setPropsArgs,
    );
  }

  return nestedSetProps;
}

export function buildObjectPropertiesForArray(params: {
  targetClassName: string | undefined;
  classNameAttr: t.JSXAttribute | false;
  styleAttr: t.JSXAttribute | false;
  spreadAttrs: t.JSXSpreadAttribute[];
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[];
  context: DynamicColorContext;
}): t.ObjectProperty[] {
  const {
    targetClassName,
    classNameAttr,
    styleAttr,
    spreadAttrs,
    attributes,
    context,
  } = params;
  const objectProperties: t.ObjectProperty[] = [];

  // Handle className
  if (targetClassName || classNameAttr || spreadAttrs.length > 0) {
    let finalClassName = targetClassName || '';

    if (classNameAttr) {
      if (t.isStringLiteral(classNameAttr.value)) {
        finalClassName =
          finalClassName ?
            `${finalClassName} ${classNameAttr.value.value}`
          : classNameAttr.value.value;
      }
      const currentClassNameIdx = attributes.indexOf(classNameAttr);
      attributes.splice(currentClassNameIdx, 1);
    }

    if (spreadAttrs.length > 0) {
      context.state.vindurImports.add('mergeClassNames');
      const mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
        t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
        t.stringLiteral(finalClassName),
      ]);
      objectProperties.push(
        t.objectProperty(t.identifier('className'), mergeCall),
      );
    } else if (finalClassName) {
      objectProperties.push(
        t.objectProperty(
          t.identifier('className'),
          t.stringLiteral(finalClassName),
        ),
      );
    }
  }

  // Handle style
  if (styleAttr || spreadAttrs.length > 0) {
    if (spreadAttrs.length > 0) {
      context.state.vindurImports.add('mergeStyles');
      const styleArgs: t.Expression[] = [
        ...spreadAttrs.map((attr) => attr.argument),
      ];

      if (styleAttr) {
        let styleValue;
        if (
          t.isJSXExpressionContainer(styleAttr.value)
          && !t.isJSXEmptyExpression(styleAttr.value.expression)
        ) {
          styleValue = styleAttr.value.expression;
        } else {
          styleValue = t.objectExpression([]);
        }
        styleArgs.push(styleValue);
        const currentStyleIdx = attributes.indexOf(styleAttr);
        attributes.splice(currentStyleIdx, 1);
      }

      const mergeStylesCall = t.callExpression(t.identifier('mergeStyles'), [
        t.arrayExpression(styleArgs),
      ]);
      objectProperties.push(
        t.objectProperty(t.identifier('style'), mergeStylesCall),
      );
    } else if (styleAttr) {
      let styleValue;
      if (
        t.isJSXExpressionContainer(styleAttr.value)
        && !t.isJSXEmptyExpression(styleAttr.value.expression)
      ) {
        styleValue = styleAttr.value.expression;
      } else {
        styleValue = t.objectExpression([]);
      }
      objectProperties.push(
        t.objectProperty(t.identifier('style'), styleValue),
      );
      const currentStyleIdx = attributes.indexOf(styleAttr);
      attributes.splice(currentStyleIdx, 1);
    }
  }

  return objectProperties;
}
