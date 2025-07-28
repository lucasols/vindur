import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import type { VindurPluginState } from '../babel-plugin';
import { findWithNarrowing } from '../utils';
import { murmur2 } from '@ls-stack/utils/hash';

export function handleJsxCxProp(
  path: NodePath<t.JSXElement>,
  context: {
    state: VindurPluginState;
    dev: boolean;
    fileHash: string;
    classIndex: () => number;
  },
): boolean {
  if (!t.isJSXIdentifier(path.node.openingElement.name)) {
    return false;
  }

  const elementName = path.node.openingElement.name.name;

  // Only allow cx prop on:
  // 1. Native DOM elements (lowercase names like div, span, etc.)
  // 2. Styled components (they will be converted to native DOM elements)
  const isNativeDOMElement =
    elementName
    && elementName.length > 0
    && elementName[0]?.toLowerCase() === elementName[0];
  const isStyledComponent = context.state.styledComponents.has(elementName);

  if (!isNativeDOMElement && !isStyledComponent) {
    // Check if this custom component has a cx prop - if so, throw an error
    const cxAttr = findWithNarrowing(path.node.openingElement.attributes, (attr) =>
      t.isJSXAttribute(attr)
      && t.isJSXIdentifier(attr.name)
      && attr.name.name === 'cx'
        ? attr
        : false,
    );

    if (cxAttr) {
      throw new Error(
        `cx prop is not supported on custom component "${elementName}". The cx prop only works on native DOM elements (like div, span, button) and styled components.`,
      );
    }

    // This is a custom component without cx prop, don't process
    return false;
  }

  const attributes = path.node.openingElement.attributes;
  const cxAttr = findWithNarrowing(attributes, (attr) =>
    t.isJSXAttribute(attr)
    && t.isJSXIdentifier(attr.name)
    && attr.name.name === 'cx'
      ? attr
      : false,
  );

  if (!cxAttr) return false;

  // Remove the cx attribute
  const cxAttrIndex = attributes.indexOf(cxAttr);
  attributes.splice(cxAttrIndex, 1);

  if (!cxAttr.value) {
    throw new Error('cx prop must have a value');
  }

  if (!t.isJSXExpressionContainer(cxAttr.value)) {
    throw new Error('cx prop must be an expression container with an object');
  }

  const expression = cxAttr.value.expression;

  if (!t.isObjectExpression(expression)) {
    throw new Error('cx prop only accepts object expressions');
  }

  // Process the object expression to hash class names
  const processedProperties = expression.properties.map((prop) => {
    if (!t.isObjectProperty(prop) || prop.computed) {
      throw new Error('cx prop object must only contain non-computed properties');
    }

    let className: string;
    
    if (t.isStringLiteral(prop.key)) {
      className = prop.key.value;
    } else if (t.isIdentifier(prop.key)) {
      className = prop.key.name;
    } else {
      throw new Error('cx prop object keys must be strings or identifiers');
    }

    // Handle $ prefix to prevent hashing
    if (className.startsWith('$')) {
      // Remove $ prefix and don't hash
      const unhashedClassName = className.slice(1);
      return t.objectProperty(
        t.stringLiteral(unhashedClassName),
        prop.value,
      );
    } else {
      // Hash the class name
      const hashedClassName = generateHashedClassName(className, context.dev, context.fileHash, context.classIndex());
      return t.objectProperty(
        t.stringLiteral(hashedClassName),
        prop.value,
      );
    }
  });

  // Create the cx() function call
  context.state.vindurImports.add('cx');
  const cxCall = t.callExpression(
    t.identifier('cx'),
    [t.objectExpression(processedProperties)],
  );

  // Add or merge with existing className
  addCxClassNameToJsx(path, cxCall, context);

  return true;
}

function generateHashedClassName(className: string, dev: boolean, fileHash: string, classIndex: number): string {
  const input = `${fileHash}-${classIndex}-cx-${className}`;
  const hash = murmur2(input);
  
  if (dev) {
    return `v${hash}-${className}`;
  } else {
    return `v${hash}`;
  }
}

function addCxClassNameToJsx(
  path: NodePath<t.JSXElement>,
  cxCall: t.CallExpression,
  context: { state: VindurPluginState },
): void {
  const attributes = path.node.openingElement.attributes;

  // Check for spread attributes
  const spreadAttrs = attributes.filter((attr) => t.isJSXSpreadAttribute(attr));

  // Find existing className attribute
  const classNameAttr = findWithNarrowing(attributes, (attr) =>
    t.isJSXAttribute(attr)
    && t.isJSXIdentifier(attr.name)
    && attr.name.name === 'className'
      ? attr
      : false,
  );

  if (spreadAttrs.length > 0) {
    // Use mergeClassNames for spread attributes
    context.state.vindurImports.add('mergeClassNames');
    
    const mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
      t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
      cxCall,
    ]);

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
      // Merge with string literal: className="existing" -> className={'existing ' + cx({...})}
      classNameAttr.value = t.jsxExpressionContainer(
        t.binaryExpression(
          '+',
          t.stringLiteral(`${classNameAttr.value.value} `),
          cxCall,
        ),
      );
    } else if (t.isJSXExpressionContainer(classNameAttr.value)) {
      // Merge with expression: className={expr} -> className={expr + ' ' + cx({...})}
      const existingExpr = classNameAttr.value.expression;
      classNameAttr.value = t.jsxExpressionContainer(
        t.binaryExpression(
          '+',
          t.binaryExpression(
            '+',
            t.isJSXEmptyExpression(existingExpr) ? t.stringLiteral('') : existingExpr,
            t.stringLiteral(' '),
          ),
          cxCall,
        ),
      );
    }
  } else {
    // Add new className attribute with cx call
    const newClassNameAttr = t.jsxAttribute(
      t.jsxIdentifier('className'),
      t.jsxExpressionContainer(cxCall),
    );
    attributes.push(newClassNameAttr);
  }
}