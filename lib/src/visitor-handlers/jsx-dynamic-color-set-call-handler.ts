import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import type { VindurPluginState } from '../babel-plugin';

type SetCallContext = {
  state: VindurPluginState;
};

type SetCallOverrides = {
  classNameOverride?: t.JSXAttribute;
  styleOverride?: t.JSXAttribute;
};

type AttributeCollections = {
  spreadAttrs: t.JSXSpreadAttribute[];
  classNameAttrs: t.JSXAttribute[];
  styleAttrs: t.JSXAttribute[];
  styledClassName?: string;
};

function collectAttributes(
  path: NodePath<t.JSXElement>,
  context: SetCallContext,
): AttributeCollections {
  const attrs = path.node.openingElement.attributes;
  const spreadAttrs = attrs.filter((attr) => t.isJSXSpreadAttribute(attr));
  const remainingAttrs = attrs.filter((attr) => t.isJSXAttribute(attr));

  const classNameAttrs = remainingAttrs.filter(
    (attr) => t.isJSXIdentifier(attr.name) && attr.name.name === 'className',
  );

  const styleAttrs = remainingAttrs.filter(
    (attr) => t.isJSXIdentifier(attr.name) && attr.name.name === 'style',
  );

  let styledClassName: string | undefined;
  if (t.isJSXIdentifier(path.node.openingElement.name)) {
    const elementName = path.node.openingElement.name.name;
    const styledInfo = context.state.styledComponents.get(elementName);
    if (styledInfo) {
      styledClassName = styledInfo.className;
    }
  }

  return { spreadAttrs, classNameAttrs, styleAttrs, styledClassName };
}

function handleClassNameOverride(
  collections: AttributeCollections,
  overrides: SetCallOverrides,
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  objectProperties: t.ObjectProperty[],
  context: SetCallContext,
): void {
  const { classNameAttrs, styledClassName, spreadAttrs } = collections;
  const classNameAttr = overrides.classNameOverride || classNameAttrs[0];

  if (classNameAttr && t.isStringLiteral(classNameAttr.value)) {
    let finalClassName = styledClassName || '';
    if (finalClassName && classNameAttr.value.value) {
      finalClassName = `${finalClassName} ${classNameAttr.value.value}`;
    } else if (classNameAttr.value.value) {
      finalClassName = classNameAttr.value.value;
    }
    objectProperties.push(
      t.objectProperty(
        t.identifier('className'),
        t.stringLiteral(finalClassName),
      ),
    );

    // Remove all className attributes
    for (const attr of classNameAttrs) {
      const idx = attributes.indexOf(attr);
      if (idx !== -1) attributes.splice(idx, 1);
    }
    if (overrides.classNameOverride) {
      const overrideIdx = attributes.indexOf(overrides.classNameOverride);
      if (overrideIdx !== -1) attributes.splice(overrideIdx, 1);
    }
  }

  // Handle style override for className override case
  if (
    overrides.styleOverride
    && t.isJSXExpressionContainer(overrides.styleOverride.value)
  ) {
    const expr = overrides.styleOverride.value.expression;
    if (!t.isJSXEmptyExpression(expr)) {
      objectProperties.push(t.objectProperty(t.identifier('style'), expr));
    }
    removeStyleAttributes(
      collections.styleAttrs,
      overrides.styleOverride,
      attributes,
    );
  } else if (spreadAttrs.length > 0) {
    context.state.vindurImports.add('mergeStyles');
    const mergeStylesCall = t.callExpression(t.identifier('mergeStyles'), [
      t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
    ]);
    objectProperties.push(
      t.objectProperty(t.identifier('style'), mergeStylesCall),
    );
  }
}

function handleSpreadProps(
  collections: AttributeCollections,
  overrides: SetCallOverrides,
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  objectProperties: t.ObjectProperty[],
  context: SetCallContext,
): void {
  const { spreadAttrs, classNameAttrs, styleAttrs, styledClassName } =
    collections;

  context.state.vindurImports.add('mergeClassNames');
  if (!overrides.styleOverride) {
    context.state.vindurImports.add('mergeStyles');
  }

  let baseClassName = styledClassName || '';
  for (const attr of classNameAttrs.filter(
    (a) => a !== overrides.classNameOverride,
  )) {
    if (t.isStringLiteral(attr.value)) {
      baseClassName =
        baseClassName && attr.value.value ?
          `${baseClassName} ${attr.value.value}`
        : attr.value.value || baseClassName;
    }
  }

  // Remove regular className attributes
  for (const attr of classNameAttrs.filter(
    (a) => a !== overrides.classNameOverride,
  )) {
    const idx = attributes.indexOf(attr);
    if (idx !== -1) attributes.splice(idx, 1);
  }

  const mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
    t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
    t.stringLiteral(baseClassName),
  ]);
  objectProperties.push(t.objectProperty(t.identifier('className'), mergeCall));

  if (
    overrides.styleOverride
    && t.isJSXExpressionContainer(overrides.styleOverride.value)
  ) {
    const expr = overrides.styleOverride.value.expression;
    if (!t.isJSXEmptyExpression(expr)) {
      objectProperties.push(t.objectProperty(t.identifier('style'), expr));
    }
    removeStyleAttributes(styleAttrs, overrides.styleOverride, attributes);
  } else {
    const mergeStylesCall = t.callExpression(t.identifier('mergeStyles'), [
      t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
    ]);
    objectProperties.push(
      t.objectProperty(t.identifier('style'), mergeStylesCall),
    );
  }
}

function handleSimpleCase(
  collections: AttributeCollections,
  overrides: SetCallOverrides,
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  objectProperties: t.ObjectProperty[],
): void {
  const { classNameAttrs, styleAttrs, styledClassName } = collections;

  let finalClassName = styledClassName || '';
  for (const attr of classNameAttrs.filter(
    (a) => a !== overrides.classNameOverride,
  )) {
    if (t.isStringLiteral(attr.value)) {
      finalClassName =
        finalClassName && attr.value.value ?
          `${finalClassName} ${attr.value.value}`
        : attr.value.value || finalClassName;
    }
  }

  // Remove regular className attributes
  for (const attr of classNameAttrs.filter(
    (a) => a !== overrides.classNameOverride,
  )) {
    const idx = attributes.indexOf(attr);
    if (idx !== -1) attributes.splice(idx, 1);
  }

  if (finalClassName) {
    objectProperties.push(
      t.objectProperty(
        t.identifier('className'),
        t.stringLiteral(finalClassName),
      ),
    );
  }

  if (
    overrides.styleOverride
    && t.isJSXExpressionContainer(overrides.styleOverride.value)
  ) {
    const expr = overrides.styleOverride.value.expression;
    if (!t.isJSXEmptyExpression(expr)) {
      objectProperties.push(t.objectProperty(t.identifier('style'), expr));
    }
    removeStyleAttributes(styleAttrs, overrides.styleOverride, attributes);
  } else if (styleAttrs.length > 0) {
    const styleAttr = styleAttrs[0];
    if (styleAttr) {
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

      // Remove all style attributes
      for (const attr of styleAttrs) {
        const idx = attributes.indexOf(attr);
        if (idx !== -1) attributes.splice(idx, 1);
      }
    }
  }
}

function removeStyleAttributes(
  styleAttrs: t.JSXAttribute[],
  styleOverride: t.JSXAttribute | undefined,
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[],
): void {
  for (const attr of styleAttrs) {
    const idx = attributes.indexOf(attr);
    if (idx !== -1) attributes.splice(idx, 1);
  }
  if (styleOverride) {
    const overrideIdx = attributes.indexOf(styleOverride);
    if (overrideIdx !== -1) attributes.splice(overrideIdx, 1);
  }
}

export function handleDynamicColorSetCall(
  path: NodePath<t.JSXElement>,
  colorName: string,
  colorArg: t.Expression,
  overrides: SetCallOverrides,
  context: SetCallContext,
): void {
  const attributes = path.node.openingElement.attributes;
  const collections = collectAttributes(path, context);
  const spArgs: t.Expression[] = [colorArg];
  const objectProperties: t.ObjectProperty[] = [];

  const hasSpreadProps = collections.spreadAttrs.length > 0;
  const hasClassNameOverride = !!overrides.classNameOverride;

  if (
    hasClassNameOverride
    && overrides.classNameOverride
    && t.isStringLiteral(overrides.classNameOverride.value)
  ) {
    handleClassNameOverride(
      collections,
      overrides,
      attributes,
      objectProperties,
      context,
    );
  } else if (hasSpreadProps) {
    handleSpreadProps(
      collections,
      overrides,
      attributes,
      objectProperties,
      context,
    );
  } else {
    handleSimpleCase(collections, overrides, attributes, objectProperties);
  }

  spArgs.push(t.objectExpression(objectProperties));

  const spCall = t.callExpression(
    t.memberExpression(t.identifier(colorName), t.identifier('_sp')),
    spArgs,
  );

  attributes.push(t.jsxSpreadAttribute(spCall));
}
