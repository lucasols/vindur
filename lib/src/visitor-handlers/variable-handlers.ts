import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import type { CssProcessingContext } from '../css-processing';
import {
  processKeyframes,
  processStyledExtension,
  processStyledTemplate,
} from '../css-processing';
import { isVariableExported } from './handler-utils';
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

type StyledElementInfo = {
  tagName: string;
  attrs: t.ObjectExpression | undefined;
};

function parseStyledElementTag(tag: t.Expression): StyledElementInfo | null {
  if (
    t.isMemberExpression(tag)
    && t.isIdentifier(tag.object)
    && tag.object.name === 'styled'
    && t.isIdentifier(tag.property)
  ) {
    // styled.div``
    return { tagName: tag.property.name, attrs: undefined };
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
    const tagName = tag.callee.object.property.name;
    if (tag.arguments.length === 1 && t.isObjectExpression(tag.arguments[0])) {
      return { tagName, attrs: tag.arguments[0] };
    } else {
      throw new Error(
        'styled.*.attrs() must be called with exactly one object literal argument',
      );
    }
  }
  return null;
}

function injectWarnings(
  warnings: string[],
  path: NodePath<t.VariableDeclarator>,
): void {
  const declarationStatement = path.findParent((p) =>
    p.isVariableDeclaration(),
  );
  if (declarationStatement) {
    for (const warning of warnings) {
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

function transformStyleFlagsComponent(
  styleFlags: NonNullable<ReturnType<typeof extractStyleFlags>>,
  result: { finalClassName: string },
  tagName: string,
  attrsExpression: t.ObjectExpression | undefined,
  varName: string,
  dev: boolean,
  path: NodePath<t.VariableDeclarator>,
  context: CssProcessingContext,
): void {
  // Transform to _vCWM function call
  context.state.vindurImports.add('_vCWM');

  // Create the modifier array: [["propName", "hashedClassName"], ...]
  const modifierArray = t.arrayExpression(
    styleFlags.map((styleProp) => t.arrayExpression([
      t.stringLiteral(styleProp.propName),
      t.stringLiteral(styleProp.hashedClassName),
    ])),
  );

  const args: t.Expression[] = [
    modifierArray,
    t.stringLiteral(result.finalClassName),
    t.stringLiteral(tagName),
  ];

  if (attrsExpression) {
    args.push(attrsExpression);
  }

  path.node.init = t.callExpression(
    t.identifier('_vCWM'),
    args,
  );

  // In dev mode, inject warnings for missing modifier styles
  if (dev) {
    const missingSelectors = checkForMissingModifierStyles(
      styleFlags,
      context.state.cssRules,
      result.finalClassName,
    );
    if (missingSelectors.length > 0) {
      const declarationStatement = path.findParent((p) =>
        p.isVariableDeclaration(),
      );
      if (declarationStatement) {
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
}

function transformRegularStyledComponent(
  isExported: boolean,
  hasAttrs: boolean,
  tagName: string,
  result: { finalClassName: string },
  attrsExpression: t.ObjectExpression | undefined,
  path: NodePath<t.VariableDeclarator>,
  context: CssProcessingContext,
): void {
  if (isExported || hasAttrs) {
    // Transform to _vSC function call for exported components or components with attrs
    context.state.vindurImports.add('_vSC');
    const args: t.Expression[] = [
      t.stringLiteral(tagName),
      t.stringLiteral(result.finalClassName),
    ];

    if (attrsExpression) {
      args.push(attrsExpression);
    }

    path.node.init = t.callExpression(t.identifier('_vSC'), args);
  } else {
    // Remove the styled component declaration for local components without attrs
    path.remove();
  }
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

  // Parse styled element pattern
  const elementInfo = parseStyledElementTag(path.node.init.tag);
  if (!elementInfo) return false;

  const varName = path.node.id.name;
  const { tagName, attrs } = elementInfo;

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
    injectWarnings(result.warnings, path);
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
  const attrsExpression = attrs;
  const hasAttrs = !!attrs;

  // Store the styled component mapping
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
    transformStyleFlagsComponent(
      styleFlags,
      result,
      tagName,
      attrsExpression,
      varName,
      dev,
      path,
      context,
    );
  } else {
    transformRegularStyledComponent(
      isExported,
      hasAttrs,
      tagName,
      result,
      attrsExpression,
      path,
      context,
    );
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
    // Transform to _vSC function call
    context.state.vindurImports.add('_vSC');
    const args: t.Expression[] = [
      t.stringLiteral(extendedInfo.element),
      t.stringLiteral(result.finalClassName),
    ];

    if (attrsExpression) {
      args.push(attrsExpression);
    }

    path.node.init = t.callExpression(t.identifier('_vSC'), args);
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


export {
  handleCreateClassNameCall,
  handleStableIdCall,
} from './call-expression-handlers';
export {
  handleStaticThemeColorsAssignment,
  handleDynamicCssColorAssignment,
  handleWithComponentAssignment,
  handleGlobalStyleVariableAssignment,
} from './additional-variable-handlers';
