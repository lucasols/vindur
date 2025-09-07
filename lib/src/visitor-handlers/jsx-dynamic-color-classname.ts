import { types as t } from '@babel/core';
import type { DynamicColorContext } from './jsx-utils';

export function handleClassNameForSingleColor(params: {
  targetClassName: string | undefined;
  classNameAttr: t.JSXAttribute | false;
  spreadAttrs: t.JSXSpreadAttribute[];
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[];
  objectProperties: t.ObjectProperty[];
  context: DynamicColorContext;
  staticFlagClasses: string[];
  dynamicFlagExprs: t.Expression[];
}): void {
  const {
    targetClassName,
    classNameAttr,
    spreadAttrs,
    attributes: attrs,
    objectProperties,
    context: ctx,
    staticFlagClasses,
    dynamicFlagExprs,
  } = params;

  if (!targetClassName && !classNameAttr) return;

  const classNameIndex = classNameAttr ? attrs.indexOf(classNameAttr) : -1;
  const lastSpreadIndex =
    spreadAttrs.length > 0 ?
      Math.max(...spreadAttrs.map((attr) => attrs.indexOf(attr)))
    : -1;

  const needsMerging =
    spreadAttrs.length > 0
    && ((classNameIndex !== -1 && classNameIndex <= lastSpreadIndex)
      || (targetClassName && classNameIndex === -1));

  if (needsMerging) {
    handleClassNameWithMerging({
      targetClassName,
      classNameAttr,
      spreadAttrs,
      attributes: attrs,
      objectProperties,
      context: ctx,
      staticFlagClasses,
      dynamicFlagExprs,
    });
  } else {
    handleSimpleClassName({
      targetClassName,
      classNameAttr,
      attributes: attrs,
      objectProperties,
      context: ctx,
      staticFlagClasses,
      dynamicFlagExprs,
    });
  }
}

export function handleClassNameWithMerging(params: {
  targetClassName: string | undefined;
  classNameAttr: t.JSXAttribute | false;
  spreadAttrs: t.JSXSpreadAttribute[];
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[];
  objectProperties: t.ObjectProperty[];
  context: DynamicColorContext;
  staticFlagClasses: string[];
  dynamicFlagExprs: t.Expression[];
}): void {
  const {
    targetClassName,
    classNameAttr,
    spreadAttrs,
    attributes: attrs,
    objectProperties,
    context: ctx,
    staticFlagClasses,
    dynamicFlagExprs,
  } = params;

  if (!classNameAttr) {
    // Handle the case where we have targetClassName but no explicit className attr
    if (targetClassName) {
      ctx.state.vindurImports.add('mergeClassNames');
      const mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
        t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
        t.stringLiteral(targetClassName),
      ]);
      if (staticFlagClasses.length > 0 || dynamicFlagExprs.length > 0) {
        ctx.state.vindurImports.add('cx');
        const cxArgs: t.Expression[] = [mergeCall];
        for (const s of staticFlagClasses) cxArgs.push(t.stringLiteral(s));
        for (const d of dynamicFlagExprs) cxArgs.push(d);
        const cxCall = t.callExpression(t.identifier('cx'), cxArgs);
        objectProperties.push(
          t.objectProperty(t.identifier('className'), cxCall),
        );
      } else {
        objectProperties.push(
          t.objectProperty(t.identifier('className'), mergeCall),
        );
      }
    }
    return;
  }

  let finalClassName = targetClassName || '';
  if (
    t.isJSXExpressionContainer(classNameAttr.value)
    && !t.isJSXEmptyExpression(classNameAttr.value.expression)
  ) {
    const classNameExpr = classNameAttr.value.expression;
    const mergeArgs = [...spreadAttrs.map((attr) => attr.argument)];

    if (targetClassName) {
      mergeArgs.push(t.stringLiteral(targetClassName));
      mergeArgs.push(classNameExpr);
    } else {
      mergeArgs.push(classNameExpr);
    }

    ctx.state.vindurImports.add('mergeClassNames');
    const mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
      t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
      ...mergeArgs.slice(spreadAttrs.length),
    ]);
    if (staticFlagClasses.length > 0 || dynamicFlagExprs.length > 0) {
      ctx.state.vindurImports.add('cx');
      const cxArgs: t.Expression[] = [mergeCall];
      for (const s of staticFlagClasses) cxArgs.push(t.stringLiteral(s));
      for (const d of dynamicFlagExprs) cxArgs.push(d);
      const cxCall = t.callExpression(t.identifier('cx'), cxArgs);
      objectProperties.push(
        t.objectProperty(t.identifier('className'), cxCall),
      );
    } else {
      objectProperties.push(
        t.objectProperty(t.identifier('className'), mergeCall),
      );
    }
  } else if (t.isStringLiteral(classNameAttr.value)) {
    if (targetClassName) {
      finalClassName = `${targetClassName} ${classNameAttr.value.value}`;
    } else {
      finalClassName = classNameAttr.value.value;
    }
    ctx.state.vindurImports.add('mergeClassNames');
    const mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
      t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
      t.stringLiteral(finalClassName),
    ]);
    if (staticFlagClasses.length > 0 || dynamicFlagExprs.length > 0) {
      ctx.state.vindurImports.add('cx');
      const cxArgs: t.Expression[] = [mergeCall];
      for (const s of staticFlagClasses) cxArgs.push(t.stringLiteral(s));
      for (const d of dynamicFlagExprs) cxArgs.push(d);
      const cxCall = t.callExpression(t.identifier('cx'), cxArgs);
      objectProperties.push(
        t.objectProperty(t.identifier('className'), cxCall),
      );
    } else {
      objectProperties.push(
        t.objectProperty(t.identifier('className'), mergeCall),
      );
    }
  }
  const currentClassNameIndex = attrs.indexOf(classNameAttr);
  attrs.splice(currentClassNameIndex, 1);
}

export function handleSimpleClassName(params: {
  targetClassName: string | undefined;
  classNameAttr: t.JSXAttribute | false;
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[];
  objectProperties: t.ObjectProperty[];
  context: DynamicColorContext;
  staticFlagClasses: string[];
  dynamicFlagExprs: t.Expression[];
}): void {
  const {
    targetClassName,
    classNameAttr,
    attributes: attrs,
    objectProperties,
    context: ctx,
    staticFlagClasses,
    dynamicFlagExprs,
  } = params;

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
        if (staticFlagClasses.length > 0 || dynamicFlagExprs.length > 0) {
          ctx.state.vindurImports.add('cx');
          const cxArgs: t.Expression[] = [combinedClassName];
          for (const s of staticFlagClasses) cxArgs.push(t.stringLiteral(s));
          for (const d of dynamicFlagExprs) cxArgs.push(d);
          const cxCall = t.callExpression(t.identifier('cx'), cxArgs);
          objectProperties.push(
            t.objectProperty(t.identifier('className'), cxCall),
          );
        } else {
          objectProperties.push(
            t.objectProperty(t.identifier('className'), combinedClassName),
          );
        }
      } else {
        if (staticFlagClasses.length > 0 || dynamicFlagExprs.length > 0) {
          ctx.state.vindurImports.add('cx');
          const cxArgs: t.Expression[] = [
            t.isJSXEmptyExpression(classNameAttr.value.expression) ?
              t.stringLiteral('')
            : classNameAttr.value.expression,
          ];
          for (const s of staticFlagClasses) cxArgs.push(t.stringLiteral(s));
          for (const d of dynamicFlagExprs) cxArgs.push(d);
          const cxCall = t.callExpression(t.identifier('cx'), cxArgs);
          objectProperties.push(
            t.objectProperty(t.identifier('className'), cxCall),
          );
        } else {
          objectProperties.push(
            t.objectProperty(
              t.identifier('className'),
              classNameAttr.value.expression,
            ),
          );
        }
      }
    } else if (t.isStringLiteral(classNameAttr.value)) {
      if (targetClassName) {
        finalClassName = `${targetClassName} ${classNameAttr.value.value}`;
      } else {
        finalClassName = classNameAttr.value.value;
      }
      if (staticFlagClasses.length > 0 || dynamicFlagExprs.length > 0) {
        ctx.state.vindurImports.add('cx');
        const cxArgs: t.Expression[] = [t.stringLiteral(finalClassName)];
        for (const s of staticFlagClasses) cxArgs.push(t.stringLiteral(s));
        for (const d of dynamicFlagExprs) cxArgs.push(d);
        const cxCall = t.callExpression(t.identifier('cx'), cxArgs);
        objectProperties.push(
          t.objectProperty(t.identifier('className'), cxCall),
        );
      } else {
        objectProperties.push(
          t.objectProperty(
            t.identifier('className'),
            t.stringLiteral(finalClassName),
          ),
        );
      }
    }
    const currentClassNameIndex = attrs.indexOf(classNameAttr);
    attrs.splice(currentClassNameIndex, 1);
  } else if (targetClassName) {
    if (staticFlagClasses.length > 0 || dynamicFlagExprs.length > 0) {
      ctx.state.vindurImports.add('cx');
      const cxArgs: t.Expression[] = [t.stringLiteral(targetClassName)];
      for (const s of staticFlagClasses) cxArgs.push(t.stringLiteral(s));
      for (const d of dynamicFlagExprs) cxArgs.push(d);
      const cxCall = t.callExpression(t.identifier('cx'), cxArgs);
      objectProperties.push(
        t.objectProperty(t.identifier('className'), cxCall),
      );
    } else {
      objectProperties.push(
        t.objectProperty(
          t.identifier('className'),
          t.stringLiteral(targetClassName),
        ),
      );
    }
  }
}

export function handleStyleForSingleColor(params: {
  styleAttr: t.JSXAttribute | false;
  spreadAttrs: t.JSXSpreadAttribute[];
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[];
  objectProperties: t.ObjectProperty[];
  context: DynamicColorContext;
}): void {
  const {
    styleAttr,
    spreadAttrs,
    attributes: attrs,
    objectProperties,
    context: ctx,
  } = params;

  const firstSpreadIndex =
    spreadAttrs.length > 0 && spreadAttrs[0] ?
      attrs.indexOf(spreadAttrs[0])
    : -1;

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
    const styleNeedsMerging =
      spreadAttrs.length > 0
      && styleIndex !== -1
      && styleIndex < firstSpreadIndex;

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
