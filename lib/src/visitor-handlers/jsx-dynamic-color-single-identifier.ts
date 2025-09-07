import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import { TransformError } from '../custom-errors';
import { filterWithNarrowing, findWithNarrowing } from '../utils';
import { collectAndRemoveStyleFlagClasses } from './inline-style-flag-utils';
import {
  handleClassNameForSingleColor,
  handleStyleForSingleColor,
} from './jsx-dynamic-color-classname';
import type { DynamicColorContext } from './jsx-utils';

export function handleSingleIdentifier(
  expression: t.Identifier,
  elementPath: NodePath<t.JSXElement>,
  attrs: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  colorAttrIndex: number,
  ctx: DynamicColorContext,
): void {
  const dynamicColorId = ctx.state.dynamicColors?.get(expression.name);
  if (!dynamicColorId) {
    throw new TransformError(
      `Unknown dynamic color variable "${expression.name}"`,
      notNullish(expression.loc),
    );
  }

  let targetClassName: string | undefined;
  let targetStyleFlags:
    | {
        propName: string;
        hashedClassName: string;
        type: 'boolean' | 'string-union';
      }[]
    | undefined;
  if (t.isJSXIdentifier(elementPath.node.openingElement.name)) {
    const elementName = elementPath.node.openingElement.name.name;
    const styledInfo = ctx.state.styledComponents.get(elementName);
    if (styledInfo) {
      targetClassName = styledInfo.className;
      if (
        !styledInfo.isExported
        && styledInfo.styleFlags
        && styledInfo.styleFlags.length > 0
      ) {
        targetStyleFlags = styledInfo.styleFlags.map((f) => ({
          propName: f.propName,
          hashedClassName: f.hashedClassName,
          type: f.type,
        }));
      }
    }
  }

  const spreadAttrs = filterWithNarrowing(attrs, (attr) =>
    t.isJSXSpreadAttribute(attr) ? attr : false,
  );

  const remainingAttrs = filterWithNarrowing(attrs, (attr) =>
    t.isJSXAttribute(attr) ? attr : false,
  );

  const classNameAttr =
    findWithNarrowing(remainingAttrs, (attr) =>
      t.isJSXIdentifier(attr.name) && attr.name.name === 'className' ?
        attr
      : false,
    ) || false;

  const styleAttr =
    findWithNarrowing(remainingAttrs, (attr) =>
      t.isJSXIdentifier(attr.name) && attr.name.name === 'style' ? attr : false,
    ) || false;

  const setPropsArgs: t.Expression[] = [t.stringLiteral('#ff6b6b')];
  const objectProperties: t.ObjectProperty[] = [];

  // Build style-flag classes and remove their attributes when present
  let staticFlagClasses: string[] = [];
  let dynamicFlagExprs: t.Expression[] = [];
  if (targetStyleFlags && targetStyleFlags.length > 0) {
    const elAttrs = elementPath.node.openingElement.attributes;
    const { staticFlagClasses: s, dynamicFlagExprs: d } =
      collectAndRemoveStyleFlagClasses(elAttrs, targetStyleFlags, ctx.state);
    staticFlagClasses = s;
    dynamicFlagExprs = d;
  }

  handleClassNameForSingleColor({
    targetClassName,
    classNameAttr,
    spreadAttrs,
    attributes: attrs,
    objectProperties,
    context: ctx,
    staticFlagClasses,
    dynamicFlagExprs,
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

  attrs.splice(colorAttrIndex, 0, t.jsxSpreadAttribute(setPropsCall));
}
