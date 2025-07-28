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
  const classNameMappings: Array<{
    original: string;
    hashed: string;
    wasDollarPrefixed?: boolean;
  }> = [];
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
        wasDollarPrefixed: true,
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

  // Update CSS rules for styled components, CSS variables, or CSS props
  if (isStyledComponent) {
    // Check for missing CSS classes and generate warnings in dev mode
    // Do this BEFORE updating CSS with hashed class names
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
    // Check for CSS variables or CSS props that need updating
    updateCssRulesForElement(path, classNameMappings, context.state);
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

function generateMissingCssClassWarnings(
  styledComponentName: string,
  classNameMappings: Array<{
    original: string;
    hashed: string;
    wasDollarPrefixed?: boolean;
  }>,
  state: VindurPluginState,
  path: NodePath<t.JSXElement>,
): void {
  // Get the styled component info to find its CSS class name
  const styledInfo = state.styledComponents.get(styledComponentName);
  if (!styledInfo) return;

  // Find missing CSS classes by checking for original class names
  // Exclude $ prefixed props from missing class checking
  const missingClasses: string[] = [];

  for (const mapping of classNameMappings) {
    // Skip $ prefixed props (they were originally prefixed with $)
    if (mapping.wasDollarPrefixed) continue;

    // Check if the CSS class exists in any CSS rule for this styled component
    // Look for &.originalClassName patterns
    const hasClass = state.cssRules.some(
      (rule) =>
        rule
        && rule.includes(`.${styledInfo.className}`)
        && rule.includes(`&.${mapping.original}`),
    );

    if (!hasClass) {
      missingClasses.push(mapping.original);
    }
  }

  // Generate warning if there are missing classes
  if (missingClasses.length > 0) {
    const warningMessage = `Warning: Missing CSS classes for cx modifiers in ${styledComponentName}: ${missingClasses.join(', ')}`;

    // Insert console.warn statement after the JSX element
    const consoleWarnStatement = t.expressionStatement(
      t.callExpression(
        t.memberExpression(t.identifier('console'), t.identifier('warn')),
        [
          t.templateLiteral(
            [
              t.templateElement(
                { raw: warningMessage, cooked: warningMessage },
                true,
              ),
            ],
            [],
          ),
        ],
      ),
    );

    // Find the parent statement and insert the warning after it
    const statementPath = path.getFunctionParent() || path.getStatementParent();
    if (statementPath) {
      statementPath.insertAfter(consoleWarnStatement);
    }
  }
}

function updateStyledComponentCss(
  styledComponentName: string,
  classNameMappings: Array<{
    original: string;
    hashed: string;
    wasDollarPrefixed?: boolean;
  }>,
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

function updateCssRulesForElement(
  path: NodePath<t.JSXElement>,
  classNameMappings: Array<{ original: string; hashed: string }>,
  state: VindurPluginState,
): void {
  // Check for className attributes that reference CSS variables
  const attributes = path.node.openingElement.attributes;
  const classNameAttr = findWithNarrowing(attributes, (attr) =>
    (
      t.isJSXAttribute(attr)
      && t.isJSXIdentifier(attr.name)
      && attr.name.name === 'className'
    ) ?
      attr
    : false,
  );

  if (classNameAttr && t.isJSXExpressionContainer(classNameAttr.value)) {
    const expression = classNameAttr.value.expression;

    // Check if this references a CSS variable
    if (t.isIdentifier(expression)) {
      const cssClassName = state.cssVariables.get(expression.name);
      if (cssClassName) {
        updateCssRulesByClassName(cssClassName, classNameMappings, state);
        return;
      }
    }
  }

  // Check for CSS prop generated rules
  // CSS props generate class names like "v1560qbr-1-css-prop-1"
  // We'll look for CSS rules that match this pattern and contain our selectors
  for (let i = 0; i < state.cssRules.length; i++) {
    const rule = state.cssRules[i];
    if (rule?.includes('css-prop-')) {
      // Check if this rule contains any of our original class names
      const hasMatchingSelector = classNameMappings.some((mapping) =>
        rule.includes(`&.${mapping.original}`),
      );

      if (hasMatchingSelector) {
        let updatedRule = rule;
        for (const mapping of classNameMappings) {
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
}

function updateCssRulesByClassName(
  cssClassName: string,
  classNameMappings: Array<{ original: string; hashed: string }>,
  state: VindurPluginState,
): void {
  // Update CSS rules that contain the CSS variable's class name
  for (let i = 0; i < state.cssRules.length; i++) {
    const rule = state.cssRules[i];
    if (rule?.includes(`.${cssClassName}`)) {
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
