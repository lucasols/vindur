import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import {
  processStyledTemplate,
  processStyledExtension,
  processGlobalStyle,
  processKeyframes,
} from '../css-processing';
import type { CssProcessingContext } from '../css-processing';

// Helper function to validate hex colors without alpha
function isValidHexColorWithoutAlpha(color: string): boolean {
  // Must start with #
  if (!color.startsWith('#')) return false;
  
  const hex = color.slice(1);
  
  // Must be either 3 or 6 characters (no alpha channel)
  if (hex.length !== 3 && hex.length !== 6) {
    return false;
  }
  
  // Must contain only valid hex characters
  return /^[0-9a-fA-F]+$/.test(hex);
}

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
  );
  classIndex.current++;

  // Track the CSS variable for future reference
  context.state.cssVariables.set(varName, result.finalClassName);

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
  const result = processStyledTemplate(
    path.node.init.quasi,
    context,
    varName,
    `styled.${tagName}`,
    dev,
    fileHash,
    classIndex.current,
  );
  classIndex.current++;

  // Store the styled component mapping
  const isExported = isVariableExported(varName, path);
  context.state.styledComponents.set(varName, {
    element: tagName,
    className: result.finalClassName,
    isExported,
  });

  // Check if the styled component is exported
  if (isExported) {
    // Transform to styledComponent function call
    context.state.vindurImports.add('styledComponent');
    path.node.init = t.callExpression(
      t.identifier('styledComponent'),
      [
        t.stringLiteral(tagName),
        t.stringLiteral(result.finalClassName),
      ],
    );
  } else {
    // Remove the styled component declaration for local components
    path.remove();
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
    path.node.init = t.callExpression(
      t.identifier('styledComponent'),
      [
        t.stringLiteral(extendedInfo.element),
        t.stringLiteral(result.finalClassName),
      ],
    );
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
    throw new Error('createStaticThemeColors must be called with an object literal');
  }
  
  // Extract the color definitions
  const colors: Record<string, string> = {};
  for (const prop of argument.properties) {
    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key) && t.isStringLiteral(prop.value)) {
      const colorName = prop.key.name;
      const colorValue = prop.value.value;
      
      // Validate that the color is a valid hex color without alpha
      if (!isValidHexColorWithoutAlpha(colorValue)) {
        throw new Error(`Invalid color "${colorValue}" for "${colorName}". Theme colors must be valid hex colors without alpha (e.g., "#ff0000" or "#f00")`);
      }
      
      colors[colorName] = colorValue;
    } else {
      throw new Error('createStaticThemeColors object must only contain string properties');
    }
  }
  
  // Store the theme colors for future reference
  context.state.themeColors ??= new Map();
  context.state.themeColors.set(varName, colors);
  
  // Replace the function call with the raw color object
  path.node.init = t.objectExpression(
    Object.entries(colors).map(([key, value]) =>
      t.objectProperty(t.identifier(key), t.stringLiteral(value))
    )
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
  path.node.init = t.callExpression(
    t.identifier('createDynamicCssColor'),
    [t.stringLiteral(dynamicColorId)],
  );
  
  return true;
}

export function handleGlobalStyleVariableAssignment(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context } = handlerContext;
  
  if (
    !context.state.vindurImports.has('createGlobalStyle')
    || !path.node.init
    || !t.isTaggedTemplateExpression(path.node.init)
    || !t.isIdentifier(path.node.init.tag)
    || path.node.init.tag.name !== 'createGlobalStyle'
  ) {
    return false;
  }

  processGlobalStyle(path.node.init.quasi, context);

  // Remove the createGlobalStyle declaration since it doesn't produce a value
  path.remove();
  
  return true;
}

// Helper function to check if a variable is exported
function isVariableExported(
  variableName: string,
  path: NodePath<t.VariableDeclarator>,
): boolean {
  // Check if the variable is part of an export declaration
  const parentPath = path.parentPath;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!parentPath || !t.isVariableDeclaration(parentPath.node)) {
    return false;
  }

  const grandParentPath = parentPath.parentPath;
  if (grandParentPath && t.isExportNamedDeclaration(grandParentPath.node)) {
    return true;
  }

  // Check if the variable is exported later with export { name }
  let currentPath: NodePath | null = path;
  while (currentPath?.node && !t.isProgram(currentPath.node)) {
    currentPath = currentPath.parentPath;
  }
  
  if (!currentPath || !t.isProgram(currentPath.node)) {
    return false;
  }
  
  const program = currentPath;

  // Look for export statements that export this variable
  if (!t.isProgram(program.node)) return false;
  
  for (const statement of program.node.body) {
    if (t.isExportNamedDeclaration(statement) && !statement.declaration) {
      // This is an export { ... } statement
      for (const specifier of statement.specifiers) {
        if (
          t.isExportSpecifier(specifier) &&
          t.isIdentifier(specifier.local) &&
          specifier.local.name === variableName
        ) {
          return true;
        }
      }
    } else if (t.isExportDefaultDeclaration(statement)) {
      // Check if it's the default export
      if (
        t.isIdentifier(statement.declaration) &&
        statement.declaration.name === variableName
      ) {
        return true;
      }
    }
  }

  return false;
}