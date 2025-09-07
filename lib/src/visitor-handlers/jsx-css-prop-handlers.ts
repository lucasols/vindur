import { TransformError } from '../custom-errors';
import type { NodePath } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import { types as t } from '@babel/core';
import type { VindurPluginState } from '../babel-plugin';
import type { CssProcessingContext } from '../css-processing';
import { processStyledTemplate } from '../css-processing';
import { filterWithNarrowing, findWithNarrowing } from '../utils';
import { createLocationFromTemplateLiteral } from '../css-source-map';

export function handleJsxCssProp(
  path: NodePath<t.JSXElement>,
  context: {
    state: VindurPluginState;
    dev: boolean;
    fileHash: string;
    classIndex: () => number;
    cssProcessingContext: () => CssProcessingContext;
    filePath: string;
    sourceContent: string;
  },
): boolean {
  if (!t.isJSXIdentifier(path.node.openingElement.name)) {
    return false;
  }

  const elementName = path.node.openingElement.name.name;

  // Check element type
  const isNativeDOMElement =
    elementName
    && elementName.length > 0
    && elementName[0]?.toLowerCase() === elementName[0];
  const isStyledComponent = context.state.styledComponents.has(elementName);
  const isCustomComponent = !isNativeDOMElement && !isStyledComponent;

  const attributes = path.node.openingElement.attributes;
  const cssAttr = findWithNarrowing(attributes, (attr) =>
    (
      t.isJSXAttribute(attr)
      && t.isJSXIdentifier(attr.name)
      && attr.name.name === 'css'
    ) ?
      attr
    : false,
  );

  if (!cssAttr) return false;

  // Mark this element as having CSS context before processing
  if (context.state.elementsWithCssContext) {
    context.state.elementsWithCssContext.add(path.node);
  }

  // For custom components, we keep the css attribute and replace its value
  // For native/styled components, we remove it
  if (!isCustomComponent) {
    const cssAttrIndex = attributes.indexOf(cssAttr);
    attributes.splice(cssAttrIndex, 1);
  }

  if (!cssAttr.value) {
    throw new TransformError(
      'css prop must have a value',
      notNullish(cssAttr.loc),
    );
  }

  let cssClassName: string | t.Expression;

  if (t.isJSXExpressionContainer(cssAttr.value)) {
    const expression = cssAttr.value.expression;

    if (t.isTemplateLiteral(expression)) {
      // Handle template literal: css={`color: red;`}
      const classIndex = context.classIndex();
      const variableName = `css-prop-${classIndex}`;
      // Create a reference object that can be mutated by processStyledTemplate
      const classIndexRef = { current: classIndex };
      
      // Capture location information from the template literal
      const location = createLocationFromTemplateLiteral(
        expression,
        context.filePath,
        context.sourceContent,
      );
      
      const result = processStyledTemplate(
        expression,
        context.cssProcessingContext(),
        variableName,
        'css-prop',
        context.dev,
        context.fileHash,
        classIndex,
        classIndexRef,
        location,
      );
      cssClassName = result.finalClassName;
    } else if (t.isIdentifier(expression)) {
      // Handle identifier values in css prop. Two cases:
      // - If it refers to a known css() variable, keep as expression
      // - If this is a custom component and the identifier is unknown, allow forwarding (keep as is)
      const cssVariable = context.state.cssVariables.get(expression.name);
      if (cssVariable) {
        cssClassName = expression;
      } else if (isCustomComponent) {
        // For custom components, allow unknown identifiers since props might be forwarded.
        cssClassName = expression;
      } else {
        throw new TransformError(
          'Invalid css prop value. Only template literals and references to css function calls are supported',
          notNullish(expression.loc),
        );
      }
    } else {
      throw new TransformError(
        'Invalid css prop value. Only template literals and references to css function calls are supported',
        notNullish(expression.loc),
      );
    }
  } else {
    throw new TransformError(
      'Invalid css prop value. Only template literals and references to css function calls are supported',
      notNullish(cssAttr.value.loc || cssAttr.loc),
    );
  }

  // For custom components, replace the css prop value with the generated class name
  if (isCustomComponent) {
    if (typeof cssClassName === 'string') {
      cssAttr.value = t.stringLiteral(cssClassName);
    } else {
      // For css function references, keep as expression
      cssAttr.value = t.jsxExpressionContainer(cssClassName);
    }
    return true;
  }

  // For styled components with css prop, we need to handle transformation here
  // to ensure both styled and css className are included
  let transformedStyledClassName: string | undefined;

  if (isStyledComponent) {
    // Get styled component info and transform the element
    const styledInfo = context.state.styledComponents.get(elementName);
    if (styledInfo) {
      transformedStyledClassName = styledInfo.className;
      // Transform to native element
      path.node.openingElement.name = t.jsxIdentifier(styledInfo.element);
      if (path.node.closingElement) {
        path.node.closingElement.name = t.jsxIdentifier(styledInfo.element);
      }
    }
  }

  // Add or merge with existing className
  addCssClassNameToJsx(path, cssClassName, transformedStyledClassName, context);

  return true;
}

function addCssClassNameToJsx(
  path: NodePath<t.JSXElement>,
  cssClassName: string | t.Expression,
  styledClassName: string | undefined,
  context: { state: VindurPluginState },
): void {
  const attributes = path.node.openingElement.attributes;

  // Check for spread attributes
  const spreadAttrs = attributes.filter((attr) => t.isJSXSpreadAttribute(attr));

  const classNameAttrs = filterWithNarrowing(attributes, (attr) =>
    (
      t.isJSXAttribute(attr)
      && t.isJSXIdentifier(attr.name)
      && attr.name.name === 'className'
    ) ?
      attr
    : false,
  );

  const lastClassNameAttr = classNameAttrs.at(-1); // Get the last className attr

  // Build the final CSS classes to add
  let finalCssClasses = '';
  if (styledClassName && typeof cssClassName === 'string') {
    finalCssClasses = `${styledClassName} ${cssClassName}`;
  } else if (typeof cssClassName === 'string') {
    finalCssClasses = cssClassName;
  }

  // Handle spread props scenario according to SPEC
  if (spreadAttrs.length > 0) {
    context.state.vindurImports.add('mergeClassNames');

    let mergeCall: t.CallExpression;
    if (typeof cssClassName === 'string') {
      mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
        t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
        t.stringLiteral(finalCssClasses),
      ]);
    } else {
      // cssClassName is an expression, need to handle styled + css expression
      if (styledClassName) {
        mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
          t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
          t.templateLiteral(
            [
              t.templateElement({
                raw: `${styledClassName} `,
                cooked: `${styledClassName} `,
              }),
              t.templateElement({ raw: '', cooked: '' }, true),
            ],
            [cssClassName],
          ),
        ]);
      } else {
        mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
          t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
          cssClassName,
        ]);
      }
    }

    if (lastClassNameAttr) {
      lastClassNameAttr.value = t.jsxExpressionContainer(mergeCall);
    } else {
      const newClassNameAttr = t.jsxAttribute(
        t.jsxIdentifier('className'),
        t.jsxExpressionContainer(mergeCall),
      );
      attributes.push(newClassNameAttr);
    }
  } else if (lastClassNameAttr) {
    // Merge with existing className (no spread props)
    if (typeof cssClassName === 'string') {
      if (t.isStringLiteral(lastClassNameAttr.value)) {
        // Merge with string literal: className="existing" -> className="existing new"
        lastClassNameAttr.value = t.stringLiteral(
          `${lastClassNameAttr.value.value} ${finalCssClasses}`,
        );
      } else if (t.isJSXExpressionContainer(lastClassNameAttr.value)) {
        // Merge with expression: className={expr} -> className={`${expr} new`}
        const existingExpr = lastClassNameAttr.value.expression;
        lastClassNameAttr.value = t.jsxExpressionContainer(
          t.templateLiteral(
            [
              t.templateElement({ raw: '', cooked: '' }),
              t.templateElement({
                raw: ` ${finalCssClasses}`,
                cooked: ` ${finalCssClasses}`,
              }),
            ],
            [
              t.isJSXEmptyExpression(existingExpr) ?
                t.stringLiteral('')
              : existingExpr,
            ],
          ),
        );
      }
    } else {
      // cssClassName is an expression
      if (t.isStringLiteral(lastClassNameAttr.value)) {
        // Merge string literal with expression: className="existing" + expr -> className={`existing ${expr}`}
        let templatePrefix = lastClassNameAttr.value.value;
        if (styledClassName) {
          templatePrefix = `${lastClassNameAttr.value.value} ${styledClassName}`;
        }
        lastClassNameAttr.value = t.jsxExpressionContainer(
          t.templateLiteral(
            [
              t.templateElement({
                raw: `${templatePrefix} `,
                cooked: `${templatePrefix} `,
              }),
              t.templateElement({ raw: '', cooked: '' }),
            ],
            [cssClassName],
          ),
        );
      } else if (t.isJSXExpressionContainer(lastClassNameAttr.value)) {
        // Merge expression with expression: `className={expr1} + expr2 -> className={`${expr1} ${expr2}`}`
        const existingExpr = lastClassNameAttr.value.expression;
        let middleTemplate = ' ';
        if (styledClassName) {
          middleTemplate = ` ${styledClassName} `;
        }
        lastClassNameAttr.value = t.jsxExpressionContainer(
          t.templateLiteral(
            [
              t.templateElement({ raw: '', cooked: '' }),
              t.templateElement({
                raw: middleTemplate,
                cooked: middleTemplate,
              }),
              t.templateElement({ raw: '', cooked: '' }),
            ],
            [
              t.isJSXEmptyExpression(existingExpr) ?
                t.stringLiteral('')
              : existingExpr,
              cssClassName,
            ],
          ),
        );
      }
    }
  } else {
    // Add new className attribute
    if (typeof cssClassName === 'string') {
      const newClassNameAttr = t.jsxAttribute(
        t.jsxIdentifier('className'),
        t.stringLiteral(finalCssClasses),
      );
      attributes.push(newClassNameAttr);
    } else {
      let classNameValue: t.Expression;
      if (styledClassName) {
        classNameValue = t.templateLiteral(
          [
            t.templateElement({
              raw: `${styledClassName} `,
              cooked: `${styledClassName} `,
            }),
            t.templateElement({ raw: '', cooked: '' }, true),
          ],
          [cssClassName],
        );
      } else {
        classNameValue = cssClassName;
      }

      const newClassNameAttr = t.jsxAttribute(
        t.jsxIdentifier('className'),
        t.jsxExpressionContainer(classNameValue),
      );
      attributes.push(newClassNameAttr);
    }
  }
}
