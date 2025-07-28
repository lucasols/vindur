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
  checkForMissingModifierStyles,
  extractStyleFlags,
  updateCssSelectorsForStyleFlags,
} from './style-flags-utils';
import { isValidHexColorWithoutAlpha, isVariableExported } from './handler-utils';


type VariableHandlerContext = {
  context: CssProcessingContext;
  dev: boolean;
  fileHash: string;
  classIndex: { current: number };
};

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
    const declarationStatement = path.findParent((p) => p.isVariableDeclaration());
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
    || !t.isMemberExpression(path.node.init.tag)
    || !t.isIdentifier(path.node.init.tag.object)
    || path.node.init.tag.object.name !== 'styled'
    || !t.isIdentifier(path.node.init.tag.property)
    || !t.isIdentifier(path.node.id)
  ) {
    return false;
  }

  // Handle styled.div`` variable assignments
  const varName = path.node.id.name;
  const tagName = path.node.init.tag.property.name;

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
    const declarationStatement = path.findParent((p) => p.isVariableDeclaration());
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

  // Store the styled component mapping
  const isExported = isVariableExported(varName, path);
  context.state.styledComponents.set(varName, {
    element: tagName,
    className: result.finalClassName,
    isExported,
    styleFlags,
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

    path.node.init = t.callExpression(t.identifier('vComponentWithModifiers'), [
      modifierArray,
      t.stringLiteral(result.finalClassName),
      t.stringLiteral(tagName), // Pass the element type
    ]);

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
    if (isExported) {
      // Transform to styledComponent function call
      context.state.vindurImports.add('styledComponent');
      path.node.init = t.callExpression(t.identifier('styledComponent'), [
        t.stringLiteral(tagName),
        t.stringLiteral(result.finalClassName),
      ]);
    } else {
      // Remove the styled component declaration for local components
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
    || !t.isCallExpression(path.node.init.tag)
    || !t.isIdentifier(path.node.init.tag.callee)
    || path.node.init.tag.callee.name !== 'styled'
    || path.node.init.tag.arguments.length !== 1
    || !t.isIdentifier(path.node.id)
  ) {
    return false;
  }

  // Handle styled(Component)`` variable assignments
  const varName = path.node.id.name;
  const extendedArg = path.node.init.tag.arguments[0];

  if (!t.isIdentifier(extendedArg)) {
    throw new Error(
      'styled() can only extend identifiers (components or css variables)',
    );
  }

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

  // Store the extended styled component mapping
  const isExported = isVariableExported(varName, path);
  context.state.styledComponents.set(varName, {
    element: extendedInfo.element,
    className: result.finalClassName,
    isExported,
  });

  // Check if the styled component is exported
  if (isExported) {
    // Transform to styledComponent function call
    context.state.vindurImports.add('styledComponent');
    path.node.init = t.callExpression(t.identifier('styledComponent'), [
      t.stringLiteral(extendedInfo.element),
      t.stringLiteral(result.finalClassName),
    ]);
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
      t.objectProperty(t.identifier(key), t.stringLiteral(value)),
    ),
  );

  return true;
}

export function handleDynamicCssColorAssignment(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context, fileHash, classIndex } = handlerContext;

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

  // Replace the function call with the hashed ID
  path.node.init = t.callExpression(t.identifier('createDynamicCssColor'), [
    t.stringLiteral(dynamicColorId),
  ]);

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

  const result = processGlobalStyle(path.node.init.quasi, context, fileHash, classIndex);

  // Inject warnings for scoped variables in dev mode
  if (dev && result.warnings && result.warnings.length > 0) {
    const declarationStatement = path.findParent((p) => p.isVariableDeclaration());
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


export { handleStableIdCall, handleCreateClassNameCall } from './call-expression-handlers';
