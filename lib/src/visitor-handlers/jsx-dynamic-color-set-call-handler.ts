import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import type { VindurPluginState } from '../babel-plugin';

export function handleDynamicColorSetCall(
  path: NodePath<t.JSXElement>,
  colorName: string,
  colorArg: t.Expression,
  overrides: {
    classNameAfterDynamicColor?: t.JSXAttribute;
    styleAfterDynamicColor?: t.JSXAttribute;
  },
  context: { state: VindurPluginState },
): void {
  const attributes = path.node.openingElement.attributes;

  // Check for spread attributes
  const spreadAttrs = attributes.filter((attr) => t.isJSXSpreadAttribute(attr));

  // Collect remaining non-spread attributes to check for className and style
  const remainingAttrs = attributes.filter((attr) => t.isJSXAttribute(attr));

  // Find className attributes
  const classNameAttrs = remainingAttrs.filter(
    (attr) => t.isJSXIdentifier(attr.name) && attr.name.name === 'className',
  );

  // Use override className if it exists, otherwise combine all className attributes
  const classNameAttr =
    overrides.classNameAfterDynamicColor || classNameAttrs[0];

  // Find all style attributes
  const styleAttrs = remainingAttrs.filter(
    (attr) => t.isJSXIdentifier(attr.name) && attr.name.name === 'style',
  );

  // Get styled component className if applicable
  let styledClassName: string | undefined;
  if (t.isJSXIdentifier(path.node.openingElement.name)) {
    const elementName = path.node.openingElement.name.name;
    const styledInfo = context.state.styledComponents.get(elementName);
    if (styledInfo) {
      styledClassName = styledInfo.className;
    }
  }

  // Build the _sp call arguments
  const spArgs: t.Expression[] = [colorArg];
  const objectProperties: t.ObjectProperty[] = [];

  // Handle className merging logic based on SPEC
  const hasSpreadProps = spreadAttrs.length > 0;
  const hasClassNameOverride = !!overrides.classNameAfterDynamicColor;

  if (
    hasClassNameOverride
    && classNameAttr
    && t.isStringLiteral(classNameAttr.value)
  ) {
    // className after dynamicColor - it overrides everything (no merging with spreads)
    // Only use the styled component className + the override className
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
    // Remove ALL className attributes (both before and after dynamicColor)
    for (const attr of classNameAttrs) {
      const classNameIdx = attributes.indexOf(attr);
      if (classNameIdx !== -1) {
        attributes.splice(classNameIdx, 1);
      }
    }
    // Also remove the override className attribute
    if (overrides.classNameAfterDynamicColor) {
      const overrideIdx = attributes.indexOf(
        overrides.classNameAfterDynamicColor,
      );
      if (overrideIdx !== -1) {
        attributes.splice(overrideIdx, 1);
      }
    }

    // Handle style override
    if (
      overrides.styleAfterDynamicColor
      && t.isJSXExpressionContainer(overrides.styleAfterDynamicColor.value)
    ) {
      // Use the override style directly in the _sp call
      const expression = overrides.styleAfterDynamicColor.value.expression;
      if (!t.isJSXEmptyExpression(expression)) {
        objectProperties.push(
          t.objectProperty(t.identifier('style'), expression),
        );
      }
      // Remove ALL style attributes (both before and after dynamicColor)
      for (const attr of styleAttrs) {
        const styleIdx = attributes.indexOf(attr);
        if (styleIdx !== -1) {
          attributes.splice(styleIdx, 1);
        }
      }
      // Also remove the override style attribute
      const styleOverrideIdx = attributes.indexOf(
        overrides.styleAfterDynamicColor,
      );
      if (styleOverrideIdx !== -1) {
        attributes.splice(styleOverrideIdx, 1);
      }
    } else if (hasSpreadProps) {
      // For style, we still need mergeStyles if there are spread props and no override
      context.state.vindurImports.add('mergeStyles');
      const mergeStylesCall = t.callExpression(t.identifier('mergeStyles'), [
        t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
      ]);
      objectProperties.push(
        t.objectProperty(t.identifier('style'), mergeStylesCall),
      );
    }
  } else if (hasSpreadProps) {
    // Need to use mergeClassNames
    context.state.vindurImports.add('mergeClassNames');
    if (!overrides.styleAfterDynamicColor) {
      context.state.vindurImports.add('mergeStyles');
    }

    let baseClassName = styledClassName || '';
    // Combine all className attributes (except override which is handled separately)
    for (const attr of classNameAttrs.filter(
      (attr) => attr !== overrides.classNameAfterDynamicColor,
    )) {
      if (t.isStringLiteral(attr.value)) {
        if (baseClassName && attr.value.value) {
          baseClassName = `${baseClassName} ${attr.value.value}`;
        } else if (attr.value.value) {
          baseClassName = attr.value.value;
        }
      }
    }

    // Remove regular className attributes (override will be handled separately)
    for (const attr of classNameAttrs.filter(
      (attr) => attr !== overrides.classNameAfterDynamicColor,
    )) {
      const classNameIdx = attributes.indexOf(attr);
      if (classNameIdx !== -1) {
        attributes.splice(classNameIdx, 1);
      }
    }

    const mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
      t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
      t.stringLiteral(baseClassName),
    ]);
    objectProperties.push(
      t.objectProperty(t.identifier('className'), mergeCall),
    );

    // Handle style merging for spread props
    if (
      overrides.styleAfterDynamicColor
      && t.isJSXExpressionContainer(overrides.styleAfterDynamicColor.value)
    ) {
      // Use the override style directly
      const expression = overrides.styleAfterDynamicColor.value.expression;
      if (!t.isJSXEmptyExpression(expression)) {
        objectProperties.push(
          t.objectProperty(t.identifier('style'), expression),
        );
      }
      // Remove ALL style attributes (both before and after dynamicColor)
      for (const attr of styleAttrs) {
        const styleIdx = attributes.indexOf(attr);
        if (styleIdx !== -1) {
          attributes.splice(styleIdx, 1);
        }
      }
      // Also remove the override style attribute
      const styleOverrideIdx = attributes.indexOf(
        overrides.styleAfterDynamicColor,
      );
      if (styleOverrideIdx !== -1) {
        attributes.splice(styleOverrideIdx, 1);
      }
    } else {
      const mergeStylesCall = t.callExpression(t.identifier('mergeStyles'), [
        t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
      ]);
      objectProperties.push(
        t.objectProperty(t.identifier('style'), mergeStylesCall),
      );
    }
  } else {
    // No spread props - simple className handling
    let finalClassName = styledClassName || '';
    // Combine all className attributes (except override which is handled separately)
    for (const attr of classNameAttrs.filter(
      (attr) => attr !== overrides.classNameAfterDynamicColor,
    )) {
      if (t.isStringLiteral(attr.value)) {
        if (finalClassName && attr.value.value) {
          finalClassName = `${finalClassName} ${attr.value.value}`;
        } else if (attr.value.value) {
          finalClassName = attr.value.value;
        }
      }
    }

    // Remove regular className attributes (override will be handled separately)
    for (const attr of classNameAttrs.filter(
      (attr) => attr !== overrides.classNameAfterDynamicColor,
    )) {
      const classNameIdx = attributes.indexOf(attr);
      if (classNameIdx !== -1) {
        attributes.splice(classNameIdx, 1);
      }
    }
    if (finalClassName) {
      objectProperties.push(
        t.objectProperty(
          t.identifier('className'),
          t.stringLiteral(finalClassName),
        ),
      );
    }

    // Handle style if present
    if (
      overrides.styleAfterDynamicColor
      && t.isJSXExpressionContainer(overrides.styleAfterDynamicColor.value)
    ) {
      // Use the override style directly
      const expression = overrides.styleAfterDynamicColor.value.expression;
      if (!t.isJSXEmptyExpression(expression)) {
        objectProperties.push(
          t.objectProperty(t.identifier('style'), expression),
        );
      }
      // Remove ALL style attributes
      for (const attr of styleAttrs) {
        const styleIdx = attributes.indexOf(attr);
        if (styleIdx !== -1) {
          attributes.splice(styleIdx, 1);
        }
      }
      // Also remove the override style attribute
      const styleOverrideIdx = attributes.indexOf(
        overrides.styleAfterDynamicColor,
      );
      if (styleOverrideIdx !== -1) {
        attributes.splice(styleOverrideIdx, 1);
      }
    } else if (styleAttrs.length > 0) {
      // Use the first style attribute (no spread props so no merging needed)
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

        // Remove ALL style attributes
        for (const attr of styleAttrs) {
          const styleIdx = attributes.indexOf(attr);
          if (styleIdx !== -1) {
            attributes.splice(styleIdx, 1);
          }
        }
      }
    }
  }

  // Create the _sp call
  spArgs.push(t.objectExpression(objectProperties));

  const spCall = t.callExpression(
    t.memberExpression(t.identifier(colorName), t.identifier('_sp')),
    spArgs,
  );

  // Add the spread attribute
  attributes.push(t.jsxSpreadAttribute(spCall));
}
