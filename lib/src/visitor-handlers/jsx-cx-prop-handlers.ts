import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import type { VindurPluginState } from '../babel-plugin';
import { TransformError } from '../custom-errors';
import { findWithNarrowing } from '../utils';
import {
  generateMissingCssClassWarnings,
  updateCssRulesForElement,
  updateStyledComponentCss,
} from './jsx-cx-prop-css-utils';
import { addCxClassNameToJsx } from './jsx-cx-prop-jsx-utils';

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
  const { isNativeDOMElement, isStyledComponent } = validateElementType(
    elementName,
    context.state,
    path,
  );

  if (!isNativeDOMElement && !isStyledComponent) {
    return false;
  }

  const attributes = path.node.openingElement.attributes;
  const cxAttr = findCxAttribute(attributes);

  if (!cxAttr) return false;

  // Validate plain DOM elements without CSS context
  if (isNativeDOMElement && !isStyledComponent) {
    validatePlainDomElement(path, context, attributes, cxAttr);
  }

  // Remove the cx attribute and validate its structure
  const cxAttrIndex = attributes.indexOf(cxAttr);
  attributes.splice(cxAttrIndex, 1);

  const expression = validateAndExtractCxExpression(cxAttr);

  // Process the object expression to hash class names
  const { classNameMappings, processedProperties } = processCxObjectExpression(
    expression,
    context,
  );

  // Update CSS rules and handle styled components
  handleCssUpdatesAndStyledComponents(
    isStyledComponent,
    elementName,
    classNameMappings,
    context,
    path,
  );

  // Create the cx() function call and add to JSX
  const cxCall = createCxCall(processedProperties, context.state);
  addCxClassNameToJsx(
    path,
    cxCall,
    context,
    isStyledComponent ? elementName : undefined,
  );

  return true;
}

function validateElementType(
  elementName: string,
  state: VindurPluginState,
  path: NodePath<t.JSXElement>,
): { isNativeDOMElement: boolean; isStyledComponent: boolean } {
  const firstChar = elementName[0];
  const isNativeDOMElement = Boolean(
    elementName
      && elementName.length > 0
      && firstChar
      && firstChar.toLowerCase() === firstChar,
  );
  const isStyledComponent = state.styledComponents.has(elementName);

  if (!isNativeDOMElement && !isStyledComponent) {
    const cxAttr = findCxAttribute(path.node.openingElement.attributes);
    if (cxAttr) {
      throw new TransformError(
        `cx prop is not supported on custom component "${elementName}". The cx prop only works on native DOM elements (like div, span, button) and styled components.`,
        null,
      );
    }
  }

  return { isNativeDOMElement, isStyledComponent };
}

function findCxAttribute(
  attributes: Array<t.JSXAttribute | t.JSXSpreadAttribute>,
): t.JSXAttribute | undefined {
  return findWithNarrowing(attributes, (attr) => {
    if (
      t.isJSXAttribute(attr)
      && t.isJSXIdentifier(attr.name)
      && attr.name.name === 'cx'
    ) {
      return attr;
    }
    return false;
  });
}

function validatePlainDomElement(
  path: NodePath<t.JSXElement>,
  context: { state: VindurPluginState },
  attributes: Array<t.JSXAttribute | t.JSXSpreadAttribute>,
  cxAttr: t.JSXAttribute,
): void {
  const hasCssContext = checkForCssContext(path, context.state, attributes);

  if (!hasCssContext) {
    validateDollarPrefixRequirement(cxAttr);
  }
}

function checkForCssContext(
  path: NodePath<t.JSXElement>,
  state: VindurPluginState,
  attributes: Array<t.JSXAttribute | t.JSXSpreadAttribute>,
): boolean {
  // Check if element was processed by css prop handler
  let hasCssContext = state.elementsWithCssContext?.has(path.node) ?? false;

  if (!hasCssContext) {
    // Check if className references a css function
    const classNameAttr = findWithNarrowing(attributes, (attr) => {
      if (
        t.isJSXAttribute(attr)
        && t.isJSXIdentifier(attr.name)
        && attr.name.name === 'className'
      ) {
        return attr;
      }
      return false;
    });

    if (classNameAttr && t.isJSXExpressionContainer(classNameAttr.value)) {
      const expression = classNameAttr.value.expression;
      if (t.isIdentifier(expression)) {
        const cssVariable = state.cssVariables.get(expression.name);
        if (cssVariable) {
          hasCssContext = true;
        }
      }
    }
  }

  return hasCssContext;
}

function validateDollarPrefixRequirement(cxAttr: t.JSXAttribute): void {
  if (!cxAttr.value || !t.isJSXExpressionContainer(cxAttr.value)) {
    throw new TransformError(
      'cx prop must be an expression container with an object',
      cxAttr.loc,
    );
  }

  const expression = cxAttr.value.expression;
  if (!t.isObjectExpression(expression)) {
    throw new TransformError('cx prop only accepts object expressions', null);
  }

  const hasNonDollarPrefixedClasses = expression.properties.some((prop) => {
    if (!t.isObjectProperty(prop) || prop.computed) {
      return false;
    }

    let className: string;
    if (t.isStringLiteral(prop.key)) {
      className = prop.key.value;
    } else if (t.isIdentifier(prop.key)) {
      className = prop.key.name;
    } else {
      return false;
    }

    return !className.startsWith('$');
  });

  if (hasNonDollarPrefixedClasses) {
    throw new TransformError(
      "cx prop on plain DOM elements requires classes to use $ prefix (e.g., $className) when not used with css prop or styled components. This ensures you're referencing external CSS classes.",
      cxAttr.loc,
    );
  }
}

function validateAndExtractCxExpression(
  cxAttr: t.JSXAttribute,
): t.ObjectExpression {
  if (!cxAttr.value) {
    throw new TransformError('cx prop must have a value', cxAttr.loc);
  }

  if (!t.isJSXExpressionContainer(cxAttr.value)) {
    throw new TransformError(
      'cx prop must be an expression container with an object',
      cxAttr.loc,
    );
  }

  const expression = cxAttr.value.expression;
  if (!t.isObjectExpression(expression)) {
    throw new TransformError('cx prop only accepts object expressions', null);
  }

  return expression;
}

function processCxObjectExpression(
  expression: t.ObjectExpression,
  context: {
    dev: boolean;
    fileHash: string;
    classIndex: () => number;
  },
): {
  classNameMappings: Array<{
    original: string;
    hashed: string;
    wasDollarPrefixed?: boolean;
  }>;
  processedProperties: t.ObjectProperty[];
} {
  const classNameMappings: Array<{
    original: string;
    hashed: string;
    wasDollarPrefixed?: boolean;
  }> = [];

  const processedProperties = expression.properties.map((prop) => {
    if (!t.isObjectProperty(prop) || prop.computed) {
      throw new TransformError(
        'cx prop object must only contain non-computed properties',
        prop.loc,
      );
    }

    let className: string;
    if (t.isStringLiteral(prop.key)) {
      className = prop.key.value;
    } else if (t.isIdentifier(prop.key)) {
      className = prop.key.name;
    } else {
      throw new TransformError(
        'cx prop object keys must be strings or identifiers',
        prop.loc,
      );
    }

    // Handle $ prefix to prevent hashing
    if (className.startsWith('$')) {
      const unhashedClassName = className.slice(1);
      classNameMappings.push({
        original: unhashedClassName,
        hashed: unhashedClassName,
        wasDollarPrefixed: true,
      });
      return t.objectProperty(t.stringLiteral(unhashedClassName), prop.value);
    } else {
      const classIndex = context.classIndex();
      const hashedClassName = generateHashedClassName(
        className,
        context.dev,
        context.fileHash,
        classIndex,
      );
      classNameMappings.push({ original: className, hashed: hashedClassName });
      return t.objectProperty(t.stringLiteral(hashedClassName), prop.value);
    }
  });

  return { classNameMappings, processedProperties };
}

function handleCssUpdatesAndStyledComponents(
  isStyledComponent: boolean,
  elementName: string,
  classNameMappings: Array<{
    original: string;
    hashed: string;
    wasDollarPrefixed?: boolean;
  }>,
  context: {
    state: VindurPluginState;
    dev: boolean;
  },
  path: NodePath<t.JSXElement>,
): void {
  if (isStyledComponent) {
    if (context.dev) {
      generateMissingCssClassWarnings(
        elementName,
        classNameMappings,
        context.state,
        path,
      );
    }

    updateStyledComponentCss(elementName, classNameMappings, context.state);

    // Transform the styled component to native element
    const styledInfo = context.state.styledComponents.get(elementName);
    if (styledInfo) {
      path.node.openingElement.name = t.jsxIdentifier(styledInfo.element);
      if (path.node.closingElement) {
        path.node.closingElement.name = t.jsxIdentifier(styledInfo.element);
      }
    }
  } else {
    updateCssRulesForElement(path, classNameMappings, context.state);
  }
}

function createCxCall(
  processedProperties: t.ObjectProperty[],
  state: VindurPluginState,
): t.CallExpression {
  state.vindurImports.add('cx');
  return t.callExpression(t.identifier('cx'), [
    t.objectExpression(processedProperties),
  ]);
}

function generateHashedClassName(
  className: string,
  dev: boolean,
  fileHash: string,
  classIndex: number,
): string {
  if (dev) {
    return `${fileHash}-${classIndex}-${className}`;
  } else {
    return `${fileHash}-${classIndex}`;
  }
}
