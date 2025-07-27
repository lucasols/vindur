import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import generate from '@babel/generator';
import type { VindurPluginState } from '../babel-plugin';
import { handleDynamicColorSetCall } from './jsx-dynamic-color-set-call-handler';

export function handleJsxDynamicColorProp(
  path: NodePath<t.JSXElement>,
  context: { state: VindurPluginState },
): boolean {
  const attributes = path.node.openingElement.attributes;
  const dynamicColorAttr = attributes.find(
    (attr): attr is t.JSXAttribute =>
      t.isJSXAttribute(attr)
      && t.isJSXIdentifier(attr.name)
      && attr.name.name === 'dynamicColor',
  );

  if (!dynamicColorAttr) {
    return false;
  }

  // Store the dynamicColor position before removing it
  const dynamicColorAttrIndex = attributes.indexOf(dynamicColorAttr);
  
  // Detect override attributes before any modifications
  const classNameAfterDynamicColor = attributes.find((attr, index): attr is t.JSXAttribute => 
    index > dynamicColorAttrIndex &&
    t.isJSXAttribute(attr) && 
    t.isJSXIdentifier(attr.name) && 
    attr.name.name === 'className'
  );
  
  const styleAfterDynamicColor = attributes.find((attr, index): attr is t.JSXAttribute => 
    index > dynamicColorAttrIndex &&
    t.isJSXAttribute(attr) && 
    t.isJSXIdentifier(attr.name) && 
    attr.name.name === 'style'
  );
  
  // Remove the dynamicColor attribute
  attributes.splice(dynamicColorAttrIndex, 1);

  if (
    !dynamicColorAttr.value
    || !t.isJSXExpressionContainer(dynamicColorAttr.value)
  ) {
    throw new Error('dynamicColor prop must have a value');
  }

  const expression = dynamicColorAttr.value.expression;

  // Check for conditional usage that should throw an error
  if (
    t.isConditionalExpression(expression)
    || t.isLogicalExpression(expression)
  ) {
    let suggestedFix = '';
    if (t.isConditionalExpression(expression)) {
      const test = generate(expression.test).code;
      const consequent = generate(expression.consequent).code;
      const alternate = generate(expression.alternate).code;
      suggestedFix = `color.set(${test} ? ${consequent.replace(/\.set\([^)]+\)/, '').replace(/color/, "'#ff6b6b'")} : ${alternate === 'null' || alternate === 'undefined' ? alternate : "'#ff6b6b'"})`;
    } else if (
      t.isLogicalExpression(expression)
      && expression.operator === '&&'
    ) {
      const left = generate(expression.left).code;
      const right = generate(expression.right).code;
      suggestedFix = `color.set(${left} ? ${right.replace(/\.set\([^)]+\)/, '').replace(/color/, "'#ff6b6b'")} : null)`;
    }
    throw new Error(
      `Conditional dynamicColor is not supported. Use condition inside the set function instead: ${suggestedFix}`,
    );
  }

  if (t.isCallExpression(expression)) {
    // Handle color.set(condition ? '#ff6b6b' : null) calls
    if (
      t.isMemberExpression(expression.callee)
      && t.isIdentifier(expression.callee.object)
      && t.isIdentifier(expression.callee.property)
      && expression.callee.property.name === 'set'
    ) {
      const colorName = expression.callee.object.name;
      const dynamicColorId = context.state.dynamicColors?.get(colorName);
      if (!dynamicColorId) {
        throw new Error(`Unknown dynamic color variable "${colorName}"`);
      }

      // Extract the color value from the set call
      const colorArg = expression.arguments[0];
      if (!colorArg || !t.isExpression(colorArg)) {
        throw new Error('color.set() must have a valid color argument');
      }

      // Handle the transformation using _sp method
      handleDynamicColorSetCall(path, colorName, colorArg, { classNameAfterDynamicColor, styleAfterDynamicColor }, context);
      return true;
    }
  }

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

    // Check for spread attributes (excluding the dynamicColor prop we just removed)
    const spreadAttrs = attributes.filter(
      (attr): attr is t.JSXSpreadAttribute => t.isJSXSpreadAttribute(attr),
    );

    // Collect remaining non-spread attributes to check for className and style
    const remainingAttrs = attributes.filter((attr): attr is t.JSXAttribute =>
      t.isJSXAttribute(attr),
    );

    const classNameAttr = remainingAttrs.find(
      (attr) => t.isJSXIdentifier(attr.name) && attr.name.name === 'className',
    );

    const styleAttr = remainingAttrs.find(
      (attr) => t.isJSXIdentifier(attr.name) && attr.name.name === 'style',
    );

    // Create the setProps arguments
    const setPropsArgs: t.Expression[] = [t.stringLiteral('#ff6b6b')]; // Default color
    const objectProperties: t.ObjectProperty[] = [];

    // Calculate spread indices for use throughout the function
    const firstSpreadIndex =
      spreadAttrs.length > 0 && spreadAttrs[0] ? attributes.indexOf(spreadAttrs[0]) : -1;

    // Handle className (for both styled components and regular elements)
    if (targetClassName || classNameAttr) {
      // Check if className comes before any spread props (needs merging)
      const classNameIndex =
        classNameAttr ? attributes.indexOf(classNameAttr) : -1;
      const lastSpreadIndex =
        spreadAttrs.length > 0 ?
          Math.max(...spreadAttrs.map((attr) => attributes.indexOf(attr)))
        : -1;
      const needsMerging =
        spreadAttrs.length > 0
        // Explicit className comes before or among spread props
        && ((classNameIndex !== -1 && classNameIndex <= lastSpreadIndex)
          // Styled component with spread props but no explicit className
          || (targetClassName && classNameIndex === -1));

      if (needsMerging) {
        // Use mergeClassNames when className comes before spread props

        let finalClassName = targetClassName || '';
        if (classNameAttr) {
          if (
            t.isJSXExpressionContainer(classNameAttr.value)
            && classNameAttr.value.expression
            && !t.isJSXEmptyExpression(classNameAttr.value.expression)
          ) {
            // Handle dynamic className with spread props
            const classNameExpr = classNameAttr.value.expression;
            const mergeArgs = [...spreadAttrs.map((attr) => attr.argument)];

            if (targetClassName) {
              mergeArgs.push(t.stringLiteral(targetClassName));
              mergeArgs.push(classNameExpr);
            } else {
              mergeArgs.push(classNameExpr);
            }

            context.state.vindurImports.add('mergeClassNames');
            const mergeCall = t.callExpression(
              t.identifier('mergeClassNames'),
              [
                t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
                ...mergeArgs.slice(spreadAttrs.length),
              ],
            );
            objectProperties.push(
              t.objectProperty(t.identifier('className'), mergeCall),
            );
          } else if (t.isStringLiteral(classNameAttr.value)) {
            // Handle static className with spread props
            if (targetClassName) {
              finalClassName = `${targetClassName} ${classNameAttr.value.value}`;
            } else {
              finalClassName = classNameAttr.value.value;
            }
            context.state.vindurImports.add('mergeClassNames');
            const mergeCall = t.callExpression(
              t.identifier('mergeClassNames'),
              [
                t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
                t.stringLiteral(finalClassName),
              ],
            );
            objectProperties.push(
              t.objectProperty(t.identifier('className'), mergeCall),
            );
          }
          // Remove the className attribute since we're handling it
          const currentClassNameIndex = attributes.indexOf(classNameAttr);
          attributes.splice(currentClassNameIndex, 1);
        } else if (targetClassName) {
          context.state.vindurImports.add('mergeClassNames');
          const mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
            t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
            t.stringLiteral(targetClassName),
          ]);
          objectProperties.push(
            t.objectProperty(t.identifier('className'), mergeCall),
          );
        }
      } else {
        // Simple className handling when no spread props
        let finalClassName = targetClassName || '';
        if (classNameAttr) {
          if (
            t.isJSXExpressionContainer(classNameAttr.value)
            && classNameAttr.value.expression
            && !t.isJSXEmptyExpression(classNameAttr.value.expression)
          ) {
            // Handle dynamic className
            if (targetClassName) {
              // Combine styled className with dynamic className
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
              objectProperties.push(
                t.objectProperty(t.identifier('className'), combinedClassName),
              );
            } else {
              objectProperties.push(
                t.objectProperty(
                  t.identifier('className'),
                  classNameAttr.value.expression,
                ),
              );
            }
          } else if (t.isStringLiteral(classNameAttr.value)) {
            // Handle static className
            if (targetClassName) {
              finalClassName = `${targetClassName} ${classNameAttr.value.value}`;
            } else {
              finalClassName = classNameAttr.value.value;
            }
            objectProperties.push(
              t.objectProperty(
                t.identifier('className'),
                t.stringLiteral(finalClassName),
              ),
            );
          }
          // Remove the className attribute since we're handling it
          const currentClassNameIndex = attributes.indexOf(classNameAttr);
          attributes.splice(currentClassNameIndex, 1);
        } else if (targetClassName) {
          objectProperties.push(
            t.objectProperty(
              t.identifier('className'),
              t.stringLiteral(targetClassName),
            ),
          );
        }
      }
    }

    // Handle style merging when there are spread props
    if (spreadAttrs.length > 0 && !styleAttr) {
      // Add mergeStyles for spread props when no explicit style
      context.state.vindurImports.add('mergeStyles');
      const mergeStylesCall = t.callExpression(t.identifier('mergeStyles'), [
        t.arrayExpression(spreadAttrs.map((attr) => attr.argument)),
      ]);
      objectProperties.push(
        t.objectProperty(t.identifier('style'), mergeStylesCall),
      );
    } else if (styleAttr) {
      // Handle explicit style
      const styleIndex = styleAttr ? attributes.indexOf(styleAttr) : -1;
      const styleNeedsMerging =
        spreadAttrs.length > 0
        && styleIndex !== -1
        && styleIndex < firstSpreadIndex;

      if (styleNeedsMerging) {
        // Merge style with spread props
        context.state.vindurImports.add('mergeStyles');
        let styleValue;
        if (
          t.isJSXExpressionContainer(styleAttr.value)
          && styleAttr.value.expression
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
        // Simple style handling
        let styleValue;
        if (
          t.isJSXExpressionContainer(styleAttr.value)
          && styleAttr.value.expression
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

      // Remove the style attribute since we're handling it
      const currentStyleIndex = attributes.indexOf(styleAttr);
      attributes.splice(currentStyleIndex, 1);
    }

    // Don't remove spread attributes - they should stay for normal prop spreading
    // The mergeClassNames call handles potential className conflicts

    // Only add object properties if there are any
    if (objectProperties.length > 0) {
      setPropsArgs.push(t.objectExpression(objectProperties));
    }

    // Transform to spread setProps
    const setPropsCall = t.callExpression(
      t.memberExpression(
        t.identifier(expression.name),
        t.identifier('_sp'),
      ),
      setPropsArgs,
    );

    // Add spread attribute - put it after the dynamicColor attribute position
    const dynamicColorPosition = dynamicColorAttrIndex;
    attributes.splice(
      dynamicColorPosition,
      0,
      t.jsxSpreadAttribute(setPropsCall),
    );
  } else if (t.isArrayExpression(expression)) {
    // Multiple dynamic colors: dynamicColor={[color1, color2]}
    // Transform to nested _sp calls
    const colorElements = expression.elements.filter((el): el is t.Identifier =>
      t.isIdentifier(el),
    );

    if (colorElements.length === 0) {
      throw new Error(
        'dynamicColor array must contain at least one color identifier',
      );
    }

    // Validate all colors are known dynamic colors
    for (const colorEl of colorElements) {
      const dynamicColorId = context.state.dynamicColors?.get(colorEl.name);
      if (!dynamicColorId) {
        throw new Error(`Unknown dynamic color variable "${colorEl.name}"`);
      }
    }

    // Check for spread props
    const spreadAttrs = attributes.filter((attr): attr is t.JSXSpreadAttribute =>
      t.isJSXSpreadAttribute(attr),
    );

    // Get className and style attributes
    const classNameAttr = attributes.find((attr): attr is t.JSXAttribute => 
      t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'className'
    );
    
    const styleAttr = attributes.find((attr): attr is t.JSXAttribute => 
      t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'style'
    );

    // Get the element name to check if it's a styled component
    let targetClassName: string | undefined;
    if (t.isJSXIdentifier(path.node.openingElement.name)) {
      const elementName = path.node.openingElement.name.name;
      const styledInfo = context.state.styledComponents.get(elementName);
      if (styledInfo) {
        targetClassName = styledInfo.className;
      }
    }

    // Create nested _sp calls - start from the innermost (last color)
    const lastColorElement = colorElements[colorElements.length - 1];
    if (!lastColorElement) {
      throw new Error('No color elements found');
    }
    let nestedSetProps: t.Expression = lastColorElement;

    // Build from right to left, creating nested calls
    for (let i = colorElements.length - 1; i >= 0; i--) {
      const colorIdentifier = colorElements[i];
      if (!colorIdentifier) {
        continue;
      }
      const setPropsArgs: t.Expression[] = [t.stringLiteral('#ff6b6b')]; // Default color

      if (i === colorElements.length - 1) {
        // Only the innermost call gets the className/style
        const objectProperties: t.ObjectProperty[] = [];

        // Handle className (styled + explicit className + spread props)
        if (targetClassName || classNameAttr || spreadAttrs.length > 0) {
          let finalClassName = targetClassName || '';

          if (classNameAttr) {
            if (t.isStringLiteral(classNameAttr.value)) {
              finalClassName = finalClassName ? `${finalClassName} ${classNameAttr.value.value}` : classNameAttr.value.value;
            }
            // Remove className attribute since we're handling it
            const currentClassNameIdx = attributes.indexOf(classNameAttr);
            attributes.splice(currentClassNameIdx, 1);
          }

          if (spreadAttrs.length > 0) {
            // Use mergeClassNames with spread props
            context.state.vindurImports.add('mergeClassNames');
            const mergeCall = t.callExpression(t.identifier('mergeClassNames'), [
              t.arrayExpression(spreadAttrs.map(attr => attr.argument)),
              t.stringLiteral(finalClassName)
            ]);
            objectProperties.push(
              t.objectProperty(t.identifier('className'), mergeCall)
            );
          } else if (finalClassName) {
            objectProperties.push(
              t.objectProperty(t.identifier('className'), t.stringLiteral(finalClassName))
            );
          }
        }

        // Handle style (explicit style + spread props)  
        if (styleAttr || spreadAttrs.length > 0) {
          if (spreadAttrs.length > 0) {
            context.state.vindurImports.add('mergeStyles');
            const styleArgs: t.Expression[] = [...spreadAttrs.map(attr => attr.argument)];

            if (styleAttr) {
              let styleValue;
              if (t.isJSXExpressionContainer(styleAttr.value) && 
                  styleAttr.value.expression && 
                  !t.isJSXEmptyExpression(styleAttr.value.expression)) {
                styleValue = styleAttr.value.expression;
              } else {
                styleValue = t.objectExpression([]);
              }
              styleArgs.push(styleValue);
              // Remove style attribute since we're handling it
              const currentStyleIdx = attributes.indexOf(styleAttr);
              attributes.splice(currentStyleIdx, 1);
            }

            const mergeStylesCall = t.callExpression(t.identifier('mergeStyles'), [
              t.arrayExpression(styleArgs)
            ]);
            objectProperties.push(
              t.objectProperty(t.identifier('style'), mergeStylesCall)
            );
          } else if (styleAttr) {
            // Handle style without spread props
            let styleValue;
            if (t.isJSXExpressionContainer(styleAttr.value) && 
                styleAttr.value.expression && 
                !t.isJSXEmptyExpression(styleAttr.value.expression)) {
              styleValue = styleAttr.value.expression;
            } else {
              styleValue = t.objectExpression([]);
            }
            objectProperties.push(
              t.objectProperty(t.identifier('style'), styleValue)
            );
            // Remove style attribute since we're handling it
            const currentStyleIdx = attributes.indexOf(styleAttr);
            attributes.splice(currentStyleIdx, 1);
          }
        }

        if (objectProperties.length > 0) {
          setPropsArgs.push(t.objectExpression(objectProperties));
        }
      } else if (i < colorElements.length - 1) {
        // Intermediate calls pass the nested _sp as second argument
        setPropsArgs.push(nestedSetProps);
      }

      nestedSetProps = t.callExpression(
        t.memberExpression(
          colorIdentifier,
          t.identifier('_sp'),
        ),
        setPropsArgs,
      );
    }

    // Add the outermost spread attribute at the position where dynamicColor was
    attributes.splice(dynamicColorAttrIndex, 0, t.jsxSpreadAttribute(nestedSetProps));
  } else {
    throw new Error(
      'dynamicColor prop must be a single identifier or array of identifiers',
    );
  }

  return true;
}

