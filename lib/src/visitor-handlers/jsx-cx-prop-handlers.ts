import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import { murmur2 } from '@ls-stack/utils/hash';
import type { VindurPluginState } from '../babel-plugin';
import { findWithNarrowing } from '../utils';

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
    const cxAttr = findWithNarrowing(
      path.node.openingElement.attributes,
      (attr) =>
        (
          t.isJSXAttribute(attr)
          && t.isJSXIdentifier(attr.name)
          && attr.name.name === 'cx'
        ) ?
          attr
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
    (
      t.isJSXAttribute(attr)
      && t.isJSXIdentifier(attr.name)
      && attr.name.name === 'cx'
    ) ?
      attr
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
  const classNameMappings: Array<{ original: string; hashed: string }> = [];
  const processedProperties = expression.properties.map((prop) => {
    if (!t.isObjectProperty(prop) || prop.computed) {
      throw new Error(
        'cx prop object must only contain non-computed properties',
      );
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
      classNameMappings.push({
        original: unhashedClassName,
        hashed: unhashedClassName,
      });
      return t.objectProperty(t.stringLiteral(unhashedClassName), prop.value);
    } else {
      // Hash the class name
      const hashedClassName = generateHashedClassName(
        className,
        context.dev,
        context.fileHash,
        context.classIndex(),
      );
      classNameMappings.push({ original: className, hashed: hashedClassName });
      return t.objectProperty(t.stringLiteral(hashedClassName), prop.value);
    }
  });

  // Update styled component CSS if this is a styled component
  if (isStyledComponent) {
    updateStyledComponentCss(elementName, classNameMappings, context.state);

    // Transform the styled component to native element
    const styledInfo = context.state.styledComponents.get(elementName);
    if (styledInfo) {
      path.node.openingElement.name = t.jsxIdentifier(styledInfo.element);
      if (path.node.closingElement) {
        path.node.closingElement.name = t.jsxIdentifier(styledInfo.element);
      }
    }
  }

  // Create the cx() function call
  context.state.vindurImports.add('cx');
  const cxCall = t.callExpression(t.identifier('cx'), [
    t.objectExpression(processedProperties),
  ]);

  // Add or merge with existing className
  addCxClassNameToJsx(
    path,
    cxCall,
    context,
    isStyledComponent ? elementName : undefined,
  );

  return true;
}

function generateHashedClassName(
  className: string,
  dev: boolean,
  fileHash: string,
  classIndex: number,
): string {
  const input = `${fileHash}-${classIndex}-cx-${className}`;
  const hash = murmur2(input);

  if (dev) {
    return `v${hash}-${className}`;
  } else {
    return `v${hash}`;
  }
}

function updateStyledComponentCss(
  styledComponentName: string,
  classNameMappings: Array<{ original: string; hashed: string }>,
  state: VindurPluginState,
): void {
  // Get the styled component info to find its CSS class name
  const styledInfo = state.styledComponents.get(styledComponentName);
  if (!styledInfo) return;

  // Update CSS rules that contain the styled component's class name
  for (let i = 0; i < state.cssRules.length; i++) {
    const rule = state.cssRules[i];
    if (rule?.includes(`.${styledInfo.className}`)) {
      let updatedRule = rule;
      for (const mapping of classNameMappings) {
        // Replace &.className with &.hashedClassName
        const selectorPattern = new RegExp(
          `&\\.${escapeRegExp(mapping.original)}\\b`,
          'g',
        );
        updatedRule = updatedRule.replace(
          selectorPattern,
          `&.${mapping.hashed}`,
        );
      }
      state.cssRules[i] = updatedRule;
    }
  }
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addCxClassNameToJsx(
  path: NodePath<t.JSXElement>,
  cxCall: t.CallExpression,
  context: { state: VindurPluginState; dev: boolean },
  styledComponentName?: string,
): void {
  const attributes = path.node.openingElement.attributes;

  // Check for spread attributes
  const spreadAttrs = attributes.filter((attr) => t.isJSXSpreadAttribute(attr));

  // Find existing className attribute
  const classNameAttr = findWithNarrowing(attributes, (attr) =>
    (
      t.isJSXAttribute(attr)
      && t.isJSXIdentifier(attr.name)
      && attr.name.name === 'className'
    ) ?
      attr
    : false,
  );

  // Get styled component className if applicable
  const styledClassName =
    styledComponentName ?
      context.state.styledComponents.get(styledComponentName)?.className
    : undefined;

  if (spreadAttrs.length > 0) {
    // Use mergeClassNames for spread attributes
    context.state.vindurImports.add('mergeClassNames');

    const mergeArgs: t.Expression[] = [
      t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
    ];

    if (styledClassName) {
      // Add styled component className and cx call as concatenated string
      mergeArgs.push(
        t.binaryExpression('+', t.stringLiteral(`${styledClassName} `), cxCall),
      );
    } else {
      mergeArgs.push(cxCall);
    }

    const mergeCall = t.callExpression(
      t.identifier('mergeClassNames'),
      mergeArgs,
    );

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
      // Merge with string literal
      let existingValue = classNameAttr.value.value;
      if (styledClassName && !existingValue.includes(styledClassName)) {
        existingValue = `${existingValue} ${styledClassName}`;
      }

      // Use string concatenation for existing string literals
      classNameAttr.value = t.jsxExpressionContainer(
        t.binaryExpression('+', t.stringLiteral(`${existingValue} `), cxCall),
      );
    } else if (t.isJSXExpressionContainer(classNameAttr.value)) {
      // Merge with expression
      const existingExpr = classNameAttr.value.expression;
      const baseExpr =
        t.isJSXEmptyExpression(existingExpr) ?
          t.stringLiteral('')
        : existingExpr;

      if (styledClassName) {
        // Include styled component className
        if (context.dev) {
          // Dev mode: string concatenation with space
          classNameAttr.value = t.jsxExpressionContainer(
            t.binaryExpression(
              '+',
              t.binaryExpression(
                '+',
                t.stringLiteral(`${styledClassName} `),
                t.binaryExpression('+', baseExpr, t.stringLiteral(' ')),
              ),
              cxCall,
            ),
          );
        } else {
          // Production: template literal
          classNameAttr.value = t.jsxExpressionContainer(
            t.templateLiteral(
              [
                t.templateElement(
                  { raw: `${styledClassName} `, cooked: `${styledClassName} ` },
                  false,
                ),
                t.templateElement({ raw: ' ', cooked: ' ' }, false),
                t.templateElement({ raw: '', cooked: '' }, true),
              ],
              [baseExpr, cxCall],
            ),
          );
        }
      } else {
        classNameAttr.value = t.jsxExpressionContainer(
          t.binaryExpression(
            '+',
            t.binaryExpression('+', baseExpr, t.stringLiteral(' ')),
            cxCall,
          ),
        );
      }
    }
  } else {
    // Add new className attribute with cx call
    let classNameExpr: t.Expression;

    if (styledClassName) {
      // Use string concatenation for styled components
      classNameExpr = t.binaryExpression(
        '+',
        t.stringLiteral(`${styledClassName} `),
        cxCall,
      );
    } else {
      classNameExpr = cxCall;
    }

    const newClassNameAttr = t.jsxAttribute(
      t.jsxIdentifier('className'),
      t.jsxExpressionContainer(classNameExpr),
    );
    attributes.push(newClassNameAttr);
  }
}
