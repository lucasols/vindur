import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import generate from '@babel/generator';
import {
  processStyledTemplate,
} from '../css-processing';
import type { CssProcessingContext } from '../css-processing';
import type { VindurPluginState } from '../babel-plugin';

// Helper function to check if an expression is a dynamic color setProps call
function isDynamicColorSetPropsCall(
  expr: t.Expression,
  context: { state: VindurPluginState },
): boolean {
  if (
    t.isCallExpression(expr) &&
    t.isMemberExpression(expr.callee) &&
    t.isIdentifier(expr.callee.object) &&
    t.isIdentifier(expr.callee.property) &&
    expr.callee.property.name === 'setProps'
  ) {
    const objectName = expr.callee.object.name;
    return Boolean(context.state.dynamicColors?.has(objectName));
  }
  return false;
}

export function handleJsxStyledComponent(
  path: NodePath<t.JSXElement>,
  context: { state: VindurPluginState },
): boolean {
  if (!t.isJSXIdentifier(path.node.openingElement.name)) {
    return false;
  }

  const elementName = path.node.openingElement.name.name;
  const styledInfo = context.state.styledComponents.get(elementName);

  if (!styledInfo) {
    return false;
  }

  // Skip transformation for exported styled components - they remain as component references
  if (styledInfo.isExported) {
    return false;
  }

  // Replace the styled component with the actual HTML element
  path.node.openingElement.name = t.jsxIdentifier(styledInfo.element);
  if (path.node.closingElement) {
    path.node.closingElement.name = t.jsxIdentifier(styledInfo.element);
  }

  handleJsxClassNameMerging(path, styledInfo, context);
  
  return true;
}

function handleJsxClassNameMerging(
  path: NodePath<t.JSXElement>,
  styledInfo: { element: string; className: string; isExported: boolean },
  context: { state: VindurPluginState },
): void {
  // Check for spread attributes
  const attributes = path.node.openingElement.attributes;
  const spreadAttrs = attributes.filter(
    (attr): attr is t.JSXSpreadAttribute =>
      t.isJSXSpreadAttribute(attr),
  );

  // Validate spread expressions - only allow simple identifiers or dynamic color setProps calls
  for (const attr of spreadAttrs) {
    if (!t.isIdentifier(attr.argument) && !isDynamicColorSetPropsCall(attr.argument, context)) {
      const expressionCode = generate(attr.argument).code;
      throw new Error(
        `Unsupported spread expression "${expressionCode}" used in vindur styled component. Only references to variables are allowed in spread expressions. Extract them to a variable and use that variable in the spread expression.`,
      );
    }
  }
  
  const classNameAttrs = attributes.filter(
    (attr): attr is t.JSXAttribute =>
      t.isJSXAttribute(attr)
      && t.isJSXIdentifier(attr.name)
      && attr.name.name === 'className',
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
  const hasDynamicColorSetPropsWithClassName = spreadAttrs.some(attr => {
    if (isDynamicColorSetPropsCall(attr.argument, context)) {
      // Check if the setProps call has a className in its second argument
      if (t.isCallExpression(attr.argument) && attr.argument.arguments.length > 1) {
        const secondArg = attr.argument.arguments[1];
        if (t.isObjectExpression(secondArg)) {
          return secondArg.properties.some(prop => 
            t.isObjectProperty(prop) && 
            t.isIdentifier(prop.key) && 
            prop.key.name === 'className'
          );
        }
      }
    }
    return false;
  });
  
  // If there's already a setProps with className, don't modify anything
  if (hasDynamicColorSetPropsWithClassName) {
    return;
  }
  // Find the last spread index
  const lastSpreadIndex = Math.max(
    ...spreadAttrs.map((attr) => attributes.indexOf(attr)),
  );

  // Only apply mergeWithSpread logic to the final className attribute
  if (existingClassNameAttr) {
    const finalClassNameIndex = attributes.indexOf(existingClassNameAttr);
    const hasSpreadsBeforeFinalClassName = lastSpreadIndex < finalClassNameIndex;
    const hasMultipleClassNames = classNameAttrs.length > 1;

    if (
      hasSpreadsBeforeFinalClassName
      && !hasMultipleClassNames
      && t.isStringLiteral(existingClassNameAttr.value)
    ) {
      // Single className comes after spreads - static merge, no mergeWithSpread needed
      existingClassNameAttr.value.value = `${styledInfo.className} ${existingClassNameAttr.value.value}`;
    } else {
      // Multiple classNames OR final className comes before/among spreads - needs mergeWithSpread
      createMergeWithSpreadCall(
        existingClassNameAttr,
        spreadAttrs,
        styledInfo,
        context,
      );
    }
  } else {
    // No existing className - add one with mergeWithSpread
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
            t.isJSXEmptyExpression(existingClassNameAttr.value.expression)
              ? t.stringLiteral('')
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
  context.state.vindurImports.add('mergeWithSpread');

  // Build the spread props array
  const spreadPropsArray = spreadAttrs.map((attr) => attr.argument);

  if (existingClassNameAttr) {
    // Include the final className value in the base
    let baseClassName = styledInfo.className;
    if (t.isStringLiteral(existingClassNameAttr.value)) {
      baseClassName = `${styledInfo.className} ${existingClassNameAttr.value.value}`;
    }

    // Create the mergeWithSpread call
    const mergeCall = t.callExpression(
      t.identifier('mergeWithSpread'),
      [
        t.arrayExpression(spreadPropsArray),
        t.stringLiteral(baseClassName),
      ],
    );

    // Replace the final className with merge call
    existingClassNameAttr.value = t.jsxExpressionContainer(mergeCall);
  } else if (attributes) {
    // No existing className - add one with mergeWithSpread
    const mergeCall = t.callExpression(
      t.identifier('mergeWithSpread'),
      [
        t.arrayExpression(spreadPropsArray),
        t.stringLiteral(styledInfo.className),
      ],
    );

    attributes.push(
      t.jsxAttribute(
        t.jsxIdentifier('className'),
        t.jsxExpressionContainer(mergeCall),
      ),
    );
  }
}

export function handleJsxDynamicColorProp(
  path: NodePath<t.JSXElement>,
  context: { state: VindurPluginState },
): boolean {
  const attributes = path.node.openingElement.attributes;
  const dynamicColorAttr = attributes.find(
    (attr): attr is t.JSXAttribute =>
      t.isJSXAttribute(attr) &&
      t.isJSXIdentifier(attr.name) &&
      attr.name.name === 'dynamicColor',
  );

  if (!dynamicColorAttr) {
    return false;
  }

  // Remove the dynamicColor attribute
  const dynamicColorAttrIndex = attributes.indexOf(dynamicColorAttr);
  attributes.splice(dynamicColorAttrIndex, 1);

  if (!dynamicColorAttr.value || !t.isJSXExpressionContainer(dynamicColorAttr.value)) {
    throw new Error('dynamicColor prop must have a value');
  }

  const expression = dynamicColorAttr.value.expression;
  
  if (t.isIdentifier(expression)) {
    // Single dynamic color: dynamicColor={color}
    const dynamicColorId = context.state.dynamicColors?.get(expression.name);
    if (!dynamicColorId) {
      throw new Error(`Unknown dynamic color variable "${expression.name}"`);
    }
    
    // Get the element name to check if it's a styled component
    let targetClassName: string | undefined;
    if (t.isJSXIdentifier(path.node.openingElement.name)) {
      const elementName = path.node.openingElement.name.name;
      const styledInfo = context.state.styledComponents.get(elementName);
      if (styledInfo) {
        targetClassName = styledInfo.className;
      }
    }
    
    // Create the setProps arguments
    const setPropsArgs = [t.stringLiteral('#ff6b6b')]; // Default color
    
    if (targetClassName) {
      // Include className in second argument
      setPropsArgs.push(
        t.objectExpression([
          t.objectProperty(
            t.identifier('className'),
            t.stringLiteral(targetClassName),
          ),
        ]),
      );
    }
    // Don't add empty object if no targetClassName
    
    // Transform to spread setProps
    const setPropsCall = t.callExpression(
      t.memberExpression(
        t.identifier(expression.name),
        t.identifier('setProps'),
      ),
      setPropsArgs,
    );
    
    // Add spread attribute
    attributes.unshift(t.jsxSpreadAttribute(setPropsCall));
    
  } else if (t.isArrayExpression(expression)) {
    // Multiple dynamic colors: dynamicColor={[color1, color2]}
    // For now, just add the array as a dynamicColor prop - this would need more complex handling
    attributes.push(
      t.jsxAttribute(
        t.jsxIdentifier('dynamicColor'),
        t.jsxExpressionContainer(expression),
      ),
    );
  } else {
    throw new Error('dynamicColor prop must be a single identifier or array of identifiers');
  }

  return true;
}

export function handleJsxCssProp(
  path: NodePath<t.JSXElement>,
  context: {
    state: VindurPluginState;
    dev: boolean;
    fileHash: string;
    classIndex: () => number;
    cssProcessingContext: () => CssProcessingContext;
  },
): boolean {
  if (!t.isJSXIdentifier(path.node.openingElement.name)) {
    return false;
  }

  const elementName = path.node.openingElement.name.name;
  
  // Only allow css prop on:
  // 1. Native DOM elements (lowercase names like div, span, etc.)
  // 2. Styled components (they will be converted to native DOM elements)
  const isNativeDOMElement = elementName && elementName.length > 0 && elementName[0]?.toLowerCase() === elementName[0];
  const isStyledComponent = context.state.styledComponents.has(elementName);
  
  if (!isNativeDOMElement && !isStyledComponent) {
    // Check if this custom component has a css prop - if so, throw an error
    const cssAttr = path.node.openingElement.attributes.find(
      (attr): attr is t.JSXAttribute =>
        t.isJSXAttribute(attr) &&
        t.isJSXIdentifier(attr.name) &&
        attr.name.name === 'css',
    );
    
    if (cssAttr) {
      throw new Error(
        `css prop is not supported on custom component "${elementName}". The css prop only works on native DOM elements (like div, span, button) and styled components.`,
      );
    }
    
    // This is a custom component without css prop, don't process
    return false;
  }

  const attributes = path.node.openingElement.attributes;
  const cssAttr = attributes.find(
    (attr): attr is t.JSXAttribute =>
      t.isJSXAttribute(attr) &&
      t.isJSXIdentifier(attr.name) &&
      attr.name.name === 'css',
  );

  if (!cssAttr) {
    return false;
  }

  // Remove the css attribute
  const cssAttrIndex = attributes.indexOf(cssAttr);
  attributes.splice(cssAttrIndex, 1);

  if (!cssAttr.value) {
    throw new Error('css prop must have a value');
  }

  let cssClassName: string | t.Expression;

  if (t.isJSXExpressionContainer(cssAttr.value)) {
    const expression = cssAttr.value.expression;

    if (t.isTemplateLiteral(expression)) {
      // Handle template literal: css={`color: red;`}
      const classIndex = context.classIndex();
      const variableName = `css-prop-${classIndex}`;
      const result = processStyledTemplate(
        expression,
        context.cssProcessingContext(),
        variableName,
        'css-prop',
        context.dev,
        context.fileHash,
        classIndex,
      );
      cssClassName = result.finalClassName;
    } else if (t.isIdentifier(expression)) {
      // Handle css function reference: css={styles}
      const cssVariable = context.state.cssVariables.get(expression.name);
      if (cssVariable) {
        // Keep as variable reference for dynamic merging
        cssClassName = expression;
      } else {
        throw new Error(
          'Invalid css prop value. Only template literals and references to css function calls are supported',
        );
      }
    } else {
      throw new Error(
        'Invalid css prop value. Only template literals and references to css function calls are supported',
      );
    }
  } else {
    throw new Error(
      'Invalid css prop value. Only template literals and references to css function calls are supported',
    );
  }

  // Add or merge with existing className
  addCssClassNameToJsx(path, cssClassName);

  return true;
}

function addCssClassNameToJsx(
  path: NodePath<t.JSXElement>,
  cssClassName: string | t.Expression,
): void {
  const attributes = path.node.openingElement.attributes;
  const classNameAttrs = attributes.filter(
    (attr): attr is t.JSXAttribute =>
      t.isJSXAttribute(attr) &&
      t.isJSXIdentifier(attr.name) &&
      attr.name.name === 'className',
  );

  const lastClassNameAttr = classNameAttrs[classNameAttrs.length - 1]; // Get the last className attr

  if (lastClassNameAttr) {
    // Merge with existing className
    if (typeof cssClassName === 'string') {
      if (t.isStringLiteral(lastClassNameAttr.value)) {
        // Merge with string literal: className="existing" -> className="existing new"
        lastClassNameAttr.value = t.stringLiteral(
          `${lastClassNameAttr.value.value} ${cssClassName}`,
        );
      } else if (
        t.isJSXExpressionContainer(lastClassNameAttr.value)
      ) {
        // Merge with expression: className={expr} -> className={`${expr} new`}
        const existingExpr = lastClassNameAttr.value.expression;
        lastClassNameAttr.value = t.jsxExpressionContainer(
          t.templateLiteral(
            [
              t.templateElement({ raw: '', cooked: '' }),
              t.templateElement({ raw: ` ${cssClassName}`, cooked: ` ${cssClassName}` }),
            ],
            [t.isJSXEmptyExpression(existingExpr) ? t.stringLiteral('') : existingExpr],
          ),
        );
      }
    } else {
      // cssClassName is an expression
      if (t.isStringLiteral(lastClassNameAttr.value)) {
        // Merge string literal with expression: className="existing" + expr -> className={`existing ${expr}`}
        lastClassNameAttr.value = t.jsxExpressionContainer(
          t.templateLiteral(
            [
              t.templateElement({ raw: `${lastClassNameAttr.value.value  } `, cooked: `${lastClassNameAttr.value.value  } ` }),
              t.templateElement({ raw: '', cooked: '' }),
            ],
            [cssClassName],
          ),
        );
      } else if (
        t.isJSXExpressionContainer(lastClassNameAttr.value)
      ) {
        // Merge expression with expression: className={expr1} + expr2 -> className={`${expr1} ${expr2}`}
        const existingExpr = lastClassNameAttr.value.expression;
        lastClassNameAttr.value = t.jsxExpressionContainer(
          t.templateLiteral(
            [
              t.templateElement({ raw: '', cooked: '' }),
              t.templateElement({ raw: ' ', cooked: ' ' }),
              t.templateElement({ raw: '', cooked: '' }),
            ],
            [t.isJSXEmptyExpression(existingExpr) ? t.stringLiteral('') : existingExpr, cssClassName],
          ),
        );
      }
    }
  } else {
    // Add new className attribute
    if (typeof cssClassName === 'string') {
      const newClassNameAttr = t.jsxAttribute(
        t.jsxIdentifier('className'),
        t.stringLiteral(cssClassName),
      );
      attributes.push(newClassNameAttr);
    } else {
      const newClassNameAttr = t.jsxAttribute(
        t.jsxIdentifier('className'),
        t.jsxExpressionContainer(cssClassName),
      );
      attributes.push(newClassNameAttr);
    }
  }
}