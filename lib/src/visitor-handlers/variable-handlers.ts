import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import type { CssProcessingContext } from '../css-processing';
import {
  processGlobalStyle,
  processKeyframes,
  processStyledExtension,
  processStyledTemplate,
} from '../css-processing';
import {
  isValidHexColorWithoutAlpha,
  isVariableExported,
} from './handler-utils';
import {
  checkForMissingModifierStyles,
  extractStyleFlags,
  updateCssSelectorsForStyleFlags,
} from './style-flags-utils';

type VariableHandlerContext = {
  context: CssProcessingContext;
  dev: boolean;
  fileHash: string;
  classIndex: { current: number };
};

export function handleLocalVindurFnError(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context } = handlerContext;

  if (
    !context.state.vindurImports.has('vindurFn')
    || !path.node.init
    || !t.isCallExpression(path.node.init)
    || !t.isIdentifier(path.node.init.callee)
    || path.node.init.callee.name !== 'vindurFn'
    || path.node.init.arguments.length !== 1
    || !t.isIdentifier(path.node.id)
  ) {
    return false;
  }

  const functionName = path.node.id.name;
  throw new Error(
    `vindurFn "${functionName}" must be exported, locally declared vindurFn functions are not supported. `
      + `If you are trying to use a vindurFn function, you must import it from another file.`,
  );
}

export function handleCssVariableAssignment(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex } = handlerContext;

  if (
    !context.state.vindurImports.has('css')
    || !path.node.init
    || !t.isTaggedTemplateExpression(path.node.init)
    || !t.isIdentifier(path.node.init.tag)
    || path.node.init.tag.name !== 'css'
    || !t.isIdentifier(path.node.id)
  ) {
    return false;
  }

  const varName = path.node.id.name;
  const result = processStyledTemplate(
    path.node.init.quasi,
    context,
    varName,
    'css',
    dev,
    fileHash,
    classIndex.current,
    classIndex,
  );
  classIndex.current++;

  // Track the CSS variable for future reference
  context.state.cssVariables.set(varName, result.finalClassName);

  // Inject warnings for scoped variables in dev mode
  if (dev && result.warnings && result.warnings.length > 0) {
    const declarationStatement = path.findParent((p) =>
      p.isVariableDeclaration(),
    );
    if (declarationStatement) {
      for (const warning of result.warnings) {
        const warnStatement = t.expressionStatement(
          t.callExpression(
            t.memberExpression(t.identifier('console'), t.identifier('warn')),
            [t.stringLiteral(warning)],
          ),
        );
        declarationStatement.insertAfter(warnStatement);
      }
    }
  }

  // Replace the tagged template with the class name string
  path.node.init = t.stringLiteral(result.finalClassName);

  return true;
}

export function handleStyledElementAssignment(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex } = handlerContext;

  if (
    !context.state.vindurImports.has('styled')
    || !path.node.init
    || !t.isTaggedTemplateExpression(path.node.init)
    || !t.isIdentifier(path.node.id)
  ) {
    return false;
  }

  // Check for styled.div`` or styled.div.attrs({...})`` patterns
  const tag = path.node.init.tag;
  let tagName: string;
  let attrs: t.ObjectExpression | undefined;

  if (
    t.isMemberExpression(tag)
    && t.isIdentifier(tag.object)
    && tag.object.name === 'styled'
    && t.isIdentifier(tag.property)
  ) {
    // styled.div``
    tagName = tag.property.name;
  } else if (
    t.isCallExpression(tag)
    && t.isMemberExpression(tag.callee)
    && t.isMemberExpression(tag.callee.object)
    && t.isIdentifier(tag.callee.object.object)
    && tag.callee.object.object.name === 'styled'
    && t.isIdentifier(tag.callee.object.property)
    && t.isIdentifier(tag.callee.property)
    && tag.callee.property.name === 'attrs'
  ) {
    // styled.div.attrs({...})``
    tagName = tag.callee.object.property.name;
    if (tag.arguments.length === 1 && t.isObjectExpression(tag.arguments[0])) {
      attrs = tag.arguments[0];
    } else {
      throw new Error(
        'styled.*.attrs() must be called with exactly one object literal argument',
      );
    }
  } else {
    return false;
  }

  // Handle styled.div`` variable assignments
  const varName = path.node.id.name;

  // Check for TypeScript generic type parameters (style flags)
  const typeParameters = path.node.init.typeParameters;
  const styleFlags = extractStyleFlags(typeParameters || null, fileHash, dev);

  const result = processStyledTemplate(
    path.node.init.quasi,
    context,
    varName,
    `styled.${tagName}`,
    dev,
    fileHash,
    classIndex.current,
    classIndex,
  );
  classIndex.current++;

  // Inject warnings for scoped variables in dev mode
  if (dev && result.warnings && result.warnings.length > 0) {
    const declarationStatement = path.findParent((p) =>
      p.isVariableDeclaration(),
    );
    if (declarationStatement) {
      for (const warning of result.warnings) {
        const warnStatement = t.expressionStatement(
          t.callExpression(
            t.memberExpression(t.identifier('console'), t.identifier('warn')),
            [t.stringLiteral(warning)],
          ),
        );
        declarationStatement.insertAfter(warnStatement);
      }
    }
  }

  // If we have style flags, update CSS selectors to use hashed class names
  if (styleFlags) {
    updateCssSelectorsForStyleFlags(
      styleFlags,
      context.state.cssRules,
      result.finalClassName,
    );
  }

  // Extract attrs if present - preserve expressions for runtime evaluation
  let attrsExpression: t.ObjectExpression | undefined;
  let hasAttrs = false;
  if (attrs) {
    // For attrs, we preserve the original expressions instead of evaluating them at compile time
    // This allows dynamic values to be passed through to the runtime helper
    attrsExpression = attrs;
    hasAttrs = true;
  }

  // Store the styled component mapping
  // Components with attrs should always be treated as having intermediate components
  const isExported = isVariableExported(varName, path);
  const hasIntermediateComponent = isExported || hasAttrs || !!styleFlags;
  context.state.styledComponents.set(varName, {
    element: tagName,
    className: result.finalClassName,
    isExported: hasIntermediateComponent,
    styleFlags,
    attrs: hasAttrs,
    attrsExpression,
  });

  // Transform based on whether we have style flags
  if (styleFlags) {
    // Transform to vComponentWithModifiers function call
    context.state.vindurImports.add('vComponentWithModifiers');

    // Create the modifier array: [["propName", "hashedClassName"], ...]
    const modifierArray = t.arrayExpression(
      styleFlags.map((styleProp) => {
        // All style flags use the same format: [propName, hashedClassName]
        return t.arrayExpression([
          t.stringLiteral(styleProp.propName),
          t.stringLiteral(styleProp.hashedClassName),
        ]);
      }),
    );

    const args: t.Expression[] = [
      modifierArray,
      t.stringLiteral(result.finalClassName),
      t.stringLiteral(tagName), // Pass the element type
    ];

    if (attrsExpression) {
      args.push(attrsExpression);
    }

    path.node.init = t.callExpression(
      t.identifier('vComponentWithModifiers'),
      args,
    );

    // In dev mode, inject warnings for missing modifier styles
    // Insert warnings after the entire variable declaration
    if (dev) {
      const missingSelectors = checkForMissingModifierStyles(
        styleFlags,
        context.state.cssRules,
        result.finalClassName,
      );
      if (missingSelectors.length > 0) {
        // Get the parent statement node to insert warnings after it
        const declarationStatement = path.findParent((p) =>
          p.isVariableDeclaration(),
        );
        if (declarationStatement) {
          // Insert console.warn statements after the variable declaration
          for (const missing of missingSelectors) {
            const warnStatement = t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.identifier('console'),
                  t.identifier('warn'),
                ),
                [
                  t.stringLiteral(
                    `Warning: Missing modifier styles for "${missing.original}" in ${varName}`,
                  ),
                ],
              ),
            );
            declarationStatement.insertAfter(warnStatement);
          }
        }
      }
    }
  } else {
    // Handle normal styled components (without style flags)
    if (isExported || hasAttrs) {
      // Transform to styledComponent function call for exported components or components with attrs
      context.state.vindurImports.add('styledComponent');
      const args: t.Expression[] = [
        t.stringLiteral(tagName),
        t.stringLiteral(result.finalClassName),
      ];

      if (attrsExpression) {
        args.push(attrsExpression);
      }

      path.node.init = t.callExpression(t.identifier('styledComponent'), args);
    } else {
      // Remove the styled component declaration for local components without attrs
      path.remove();
    }
  }

  return true;
}

export function handleStyledExtensionAssignment(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex } = handlerContext;

  if (
    !context.state.vindurImports.has('styled')
    || !path.node.init
    || !t.isTaggedTemplateExpression(path.node.init)
    || !t.isIdentifier(path.node.id)
  ) {
    return false;
  }

  // Check for styled(Component)`` or styled(Component).attrs({...})`` patterns
  const tag = path.node.init.tag;
  let extendedArg: t.Identifier;
  let attrs: t.ObjectExpression | undefined;

  if (
    t.isCallExpression(tag)
    && t.isIdentifier(tag.callee)
    && tag.callee.name === 'styled'
    && tag.arguments.length === 1
  ) {
    // styled(Component)``
    if (!t.isIdentifier(tag.arguments[0])) {
      throw new Error(
        'styled() can only extend identifiers (components or css variables)',
      );
    }
    extendedArg = tag.arguments[0];
  } else if (
    t.isCallExpression(tag)
    && t.isMemberExpression(tag.callee)
    && t.isCallExpression(tag.callee.object)
    && t.isIdentifier(tag.callee.object.callee)
    && tag.callee.object.callee.name === 'styled'
    && tag.callee.object.arguments.length === 1
    && t.isIdentifier(tag.callee.property)
    && tag.callee.property.name === 'attrs'
  ) {
    // styled(Component).attrs({...})``
    if (!t.isIdentifier(tag.callee.object.arguments[0])) {
      throw new Error(
        'styled() can only extend identifiers (components or css variables)',
      );
    }
    extendedArg = tag.callee.object.arguments[0];
    if (tag.arguments.length === 1 && t.isObjectExpression(tag.arguments[0])) {
      attrs = tag.arguments[0];
    } else {
      throw new Error(
        'styled(Component).attrs() must be called with exactly one object literal argument',
      );
    }
  } else {
    return false;
  }

  // Handle styled(Component)`` variable assignments
  const varName = path.node.id.name;
  const extendedName = extendedArg.name;
  const result = processStyledExtension(
    path.node.init.quasi,
    context,
    varName,
    extendedName,
    dev,
    fileHash,
    classIndex.current,
    classIndex,
  );
  classIndex.current++;

  // Get the extended component info for element inheritance
  const extendedInfo = context.state.styledComponents.get(extendedName);
  if (!extendedInfo) {
    throw new Error(
      `Cannot extend "${extendedName}": it is not a styled component. Only styled components can be extended.`,
    );
  }

  // Extract attrs if present - preserve expressions for runtime evaluation
  let attrsExpression: t.ObjectExpression | undefined;
  let hasAttrs = false;
  if (attrs) {
    // For attrs, we preserve the original expressions instead of evaluating them at compile time
    // This allows dynamic values to be passed through to the runtime helper
    attrsExpression = attrs;
    hasAttrs = true;
  }

  // Store the extended styled component mapping
  // Components with attrs should always be treated as having intermediate components
  // Note: result.finalClassName already contains the concatenated class names from processStyledExtension
  const isExported = isVariableExported(varName, path);
  const hasIntermediateComponent = isExported || hasAttrs;
  context.state.styledComponents.set(varName, {
    element: extendedInfo.element,
    className: result.finalClassName,
    isExported: hasIntermediateComponent,
    attrs: hasAttrs,
    attrsExpression,
  });

  // Check if the styled component should have an intermediate component
  if (hasIntermediateComponent) {
    // Transform to styledComponent function call
    context.state.vindurImports.add('styledComponent');
    const args: t.Expression[] = [
      t.stringLiteral(extendedInfo.element),
      t.stringLiteral(result.finalClassName),
    ];

    if (attrsExpression) {
      args.push(attrsExpression);
    }

    path.node.init = t.callExpression(t.identifier('styledComponent'), args);
  } else {
    // Remove the styled component declaration for local components
    path.remove();
  }

  return true;
}

export function handleKeyframesVariableAssignment(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex } = handlerContext;

  if (
    !context.state.vindurImports.has('keyframes')
    || !path.node.init
    || !t.isTaggedTemplateExpression(path.node.init)
    || !t.isIdentifier(path.node.init.tag)
    || path.node.init.tag.name !== 'keyframes'
  ) {
    return false;
  }

  const varName = t.isIdentifier(path.node.id) ? path.node.id.name : undefined;

  const result = processKeyframes(
    path.node.init.quasi,
    context,
    varName,
    dev,
    fileHash,
    classIndex.current,
  );
  classIndex.current++;

  // Track the keyframes for future reference
  if (varName) {
    context.state.keyframes.set(varName, result.finalClassName);
  }

  // Replace the keyframes call with animation name string
  path.node.init = t.stringLiteral(result.finalClassName);

  return true;
}

export function handleStaticThemeColorsAssignment(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context } = handlerContext;

  if (
    !context.state.vindurImports.has('createStaticThemeColors')
    || !path.node.init
    || !t.isCallExpression(path.node.init)
    || !t.isIdentifier(path.node.init.callee)
    || path.node.init.callee.name !== 'createStaticThemeColors'
    || path.node.init.arguments.length !== 1
    || !t.isIdentifier(path.node.id)
  ) {
    return false;
  }

  const varName = path.node.id.name;
  const argument = path.node.init.arguments[0];

  if (!t.isObjectExpression(argument)) {
    throw new Error(
      'createStaticThemeColors must be called with an object literal',
    );
  }

  // Extract the color definitions
  const colors: Record<string, string> = {};
  for (const prop of argument.properties) {
    if (
      t.isObjectProperty(prop)
      && t.isIdentifier(prop.key)
      && t.isStringLiteral(prop.value)
    ) {
      const colorName = prop.key.name;
      const colorValue = prop.value.value;

      // Validate that the color is a valid hex color without alpha
      if (!isValidHexColorWithoutAlpha(colorValue)) {
        throw new Error(
          `Invalid color "${colorValue}" for "${colorName}". Theme colors must be valid hex colors without alpha (e.g., "#ff0000" or "#f00")`,
        );
      }

      colors[colorName] = colorValue;
    } else {
      throw new Error(
        'createStaticThemeColors object must only contain string properties',
      );
    }
  }

  // Store the theme colors for future reference
  context.state.themeColors ??= new Map();
  context.state.themeColors.set(varName, colors);

  // Replace the function call with the raw color object
  path.node.init = t.objectExpression(
    Object.entries(colors).map(([key, value]) =>
      t.objectProperty(
        key.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/) ?
          t.identifier(key)
        : t.stringLiteral(key),
        t.stringLiteral(value),
      ),
    ),
  );

  return true;
}

export function handleDynamicCssColorAssignment(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex } = handlerContext;

  if (
    !context.state.vindurImports.has('createDynamicCssColor')
    || !path.node.init
    || !t.isCallExpression(path.node.init)
    || !t.isIdentifier(path.node.init.callee)
    || path.node.init.callee.name !== 'createDynamicCssColor'
    || !t.isIdentifier(path.node.id)
  ) {
    return false;
  }

  // Check if any arguments are passed - this should throw an error
  if (path.node.init.arguments.length > 0) {
    throw new Error(
      'createDynamicCssColor() should not be called with an ID parameter. The ID is automatically generated by the compiler.',
    );
  }

  const varName = path.node.id.name;

  // Generate a unique hash ID for this dynamic color
  const dynamicColorId = `${fileHash}-${classIndex.current}`;
  classIndex.current++;

  // Store the dynamic color for future reference
  context.state.dynamicColors ??= new Map();
  context.state.dynamicColors.set(varName, dynamicColorId);

  // Replace the function call with the hashed ID and dev mode
  path.node.init = t.callExpression(t.identifier('createDynamicCssColor'), [
    t.stringLiteral(dynamicColorId),
    t.booleanLiteral(dev),
  ]);

  return true;
}

export function handleWithComponentAssignment(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context } = handlerContext;

  if (
    !context.state.vindurImports.has('styled')
    || !path.node.init
    || !t.isCallExpression(path.node.init)
    || !t.isMemberExpression(path.node.init.callee)
    || !t.isIdentifier(path.node.init.callee.object)
    || !t.isIdentifier(path.node.init.callee.property)
    || path.node.init.callee.property.name !== 'withComponent'
    || path.node.init.arguments.length !== 1
    || !t.isIdentifier(path.node.id)
  ) {
    return false;
  }

  // Handle Component.withComponent('element') variable assignments
  const varName = path.node.id.name;
  const baseComponentName = path.node.init.callee.object.name;
  const elementArg = path.node.init.arguments[0];

  // Handle both string literals (for DOM elements) and identifiers (for custom components)
  let newElementType: string;
  let isCustomComponent = false;

  if (t.isStringLiteral(elementArg)) {
    // DOM element: styled.button -> withComponent('div')
    newElementType = elementArg.value;
  } else if (t.isIdentifier(elementArg)) {
    // Custom component: MyButton -> withComponent(MyComponent)
    newElementType = elementArg.name;
    isCustomComponent = true;
  } else {
    throw new Error(
      'withComponent() must be called with either a string literal element name or a component identifier.',
    );
  }

  // Get the base component info
  const baseComponentInfo =
    context.state.styledComponents.get(baseComponentName);
  if (!baseComponentInfo) {
    throw new Error(
      `Cannot call withComponent on "${baseComponentName}": it is not a styled component.`,
    );
  }

  // Store the new styled component mapping with the new element type but same className
  // Components with attrs should always be treated as having intermediate components
  const isExported = isVariableExported(varName, path);
  const hasIntermediateComponent =
    isExported || !!baseComponentInfo.attrs || !!baseComponentInfo.styleFlags;
  context.state.styledComponents.set(varName, {
    element: newElementType,
    className: baseComponentInfo.className,
    isExported: hasIntermediateComponent,
    styleFlags: baseComponentInfo.styleFlags,
    attrs: baseComponentInfo.attrs,
    attrsExpression: baseComponentInfo.attrsExpression,
  });

  // Transform based on whether we have style flags and export status
  if (baseComponentInfo.styleFlags) {
    // Transform to vComponentWithModifiers function call
    context.state.vindurImports.add('vComponentWithModifiers');

    // Create the modifier array: [["propName", "hashedClassName"], ...]
    const modifierArray = t.arrayExpression(
      baseComponentInfo.styleFlags.map((styleProp) => {
        return t.arrayExpression([
          t.stringLiteral(styleProp.propName),
          t.stringLiteral(styleProp.hashedClassName),
        ]);
      }),
    );

    const vComponentArgs: t.Expression[] = [
      modifierArray,
      t.stringLiteral(baseComponentInfo.className),
      isCustomComponent ?
        t.identifier(newElementType)
      : t.stringLiteral(newElementType), // Pass component reference for custom components
    ];

    if (baseComponentInfo.attrsExpression) {
      vComponentArgs.push(baseComponentInfo.attrsExpression);
    }

    path.node.init = t.callExpression(
      t.identifier('vComponentWithModifiers'),
      vComponentArgs,
    );
  } else if (hasIntermediateComponent) {
    // Transform to styledComponent function call
    context.state.vindurImports.add('styledComponent');
    const styledComponentArgs: t.Expression[] = [
      isCustomComponent ?
        t.identifier(newElementType)
      : t.stringLiteral(newElementType), // Pass component reference for custom components
      t.stringLiteral(baseComponentInfo.className),
    ];

    if (baseComponentInfo.attrsExpression) {
      styledComponentArgs.push(baseComponentInfo.attrsExpression);
    }

    path.node.init = t.callExpression(
      t.identifier('styledComponent'),
      styledComponentArgs,
    );
  } else {
    // Remove the withComponent declaration for local components
    path.remove();
  }

  return true;
}

export function handleGlobalStyleVariableAssignment(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex } = handlerContext;

  if (
    !context.state.vindurImports.has('createGlobalStyle')
    || !path.node.init
    || !t.isTaggedTemplateExpression(path.node.init)
    || !t.isIdentifier(path.node.init.tag)
    || path.node.init.tag.name !== 'createGlobalStyle'
  ) {
    return false;
  }

  const result = processGlobalStyle(
    path.node.init.quasi,
    context,
    fileHash,
    classIndex,
  );

  // Inject warnings for scoped variables in dev mode
  if (dev && result.warnings && result.warnings.length > 0) {
    const declarationStatement = path.findParent((p) =>
      p.isVariableDeclaration(),
    );
    if (declarationStatement) {
      for (const warning of result.warnings) {
        const warnStatement = t.expressionStatement(
          t.callExpression(
            t.memberExpression(t.identifier('console'), t.identifier('warn')),
            [t.stringLiteral(warning)],
          ),
        );
        declarationStatement.insertAfter(warnStatement);
      }
    }
  }

  // Remove the createGlobalStyle declaration since it doesn't produce a value
  path.remove();

  return true;
}

export {
  handleCreateClassNameCall,
  handleStableIdCall,
} from './call-expression-handlers';
