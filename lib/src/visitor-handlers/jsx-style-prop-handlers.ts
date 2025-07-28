import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import type { VindurPluginState } from '../babel-plugin';
import { transformStylePropScopedVariables } from '../scoped-css-variables';
import { filterWithNarrowing } from '../utils';

export function handleJsxStyleProp(
  path: NodePath<t.JSXElement>,
  context: {
    state: VindurPluginState;
    dev: boolean;
    fileHash: string;
  },
): boolean {
  // Check if we have scoped variables to process
  if (!context.state.scopedVariables || context.state.scopedVariables.size === 0) {
    return false;
  }

  const attributes = path.node.openingElement.attributes;
  const styleAttr = filterWithNarrowing(attributes, (attr) =>
    t.isJSXAttribute(attr)
    && t.isJSXIdentifier(attr.name)
    && attr.name.name === 'style'
      ? attr
      : false,
  )[0];

  if (!styleAttr?.value) return false;

  // Only process JSX expression containers with object expressions
  if (!t.isJSXExpressionContainer(styleAttr.value)) return false;
  
  const expression = styleAttr.value.expression;
  if (!t.isObjectExpression(expression)) return false;

  // Extract the style object properties
  const styleObject: Record<string, unknown> = {};
  let hasScopedVariables = false;

  for (const prop of expression.properties) {
    if (t.isObjectProperty(prop) && !prop.computed) {
      let key: string;
      if (t.isIdentifier(prop.key)) {
        key = prop.key.name;
      } else if (t.isStringLiteral(prop.key)) {
        key = prop.key.value;
      } else {
        continue;
      }

      // Check if this is a scoped variable
      if (key.startsWith('---')) {
        hasScopedVariables = true;
      }

      // Store the property value node for later transformation
      styleObject[key] = prop.value;
    }
  }

  if (!hasScopedVariables) return false;

  // Transform the scoped variables
  const { transformedStyle, warnings } = transformStylePropScopedVariables(
    styleObject,
    context.state.scopedVariables,
    context.fileHash,
    context.dev,
  );

  // Log warnings in dev mode
  if (context.dev && warnings.length > 0) {
    for (const warning of warnings) {
      console.warn(warning);
    }
  }

  // Create new object properties with transformed keys
  const newProperties: t.ObjectProperty[] = [];
  
  for (const [key, value] of Object.entries(transformedStyle)) {
    // Check if value is a Babel AST Expression node
    if (value && typeof value === 'object' && value !== null && t.isExpression(value as t.Node)) {
      newProperties.push(
        t.objectProperty(
          t.stringLiteral(key),
          value as t.Expression,
        ),
      );
    }
  }

  // Replace the original properties
  expression.properties = newProperties;

  return true;
}