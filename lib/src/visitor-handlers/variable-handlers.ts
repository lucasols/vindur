import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import type { CssProcessingContext } from '../css-processing';
import {
  processKeyframes,
  processStyledExtension,
  processStyledTemplate,
} from '../css-processing';
import { createLocationFromTemplateLiteral } from '../css-source-map';
import { TransformError, TransformWarning } from '../custom-errors';
import { isVariableExported } from './handler-utils';
import {
  extractStyleFlags,
  updateCssSelectorsForStyleFlags,
  checkForMissingModifierStyles,
  type StyleFlag,
} from './style-flags-utils';
import {
  parseStyledElementTag,
  transformRegularStyledComponent,
  transformStyleFlagsComponent,
  validateExtendedComponent,
  transformStyledExtension,
} from './utils/styled-helpers';

type VariableHandlerContext = {
  context: CssProcessingContext;
  dev: boolean;
  fileHash: string;
  classIndex: { current: number };
  filePath: string;
};

function collectDeclaredStyleClasses(styleFlags: StyleFlag[] | undefined): Set<string> {
  const declared = new Set<string>();
  if (!styleFlags) return declared;
  for (const flag of styleFlags) {
    if (flag.type === 'boolean') {
      declared.add(flag.propName);
    } else {
      for (const v of flag.unionValues) {
        declared.add(`${flag.propName}-${v}`);
      }
    }
  }
  return declared;
}

function collectUsedClassesFromCss(cssContent: string): Set<string> {
  // Strip block comments to avoid false positives
  const withoutComments = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
  const used = new Set<string>();
  // Capture patterns like &.class, &.class1.class2, &.class:hover, etc.
  const topSelectorRegex = /&\.([A-Za-z_-][A-Za-z0-9_-]*(?:\.[A-Za-z_-][A-Za-z0-9_-]*)*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = topSelectorRegex.exec(withoutComments)) !== null) {
    const group = match[1];
    if (typeof group === 'string') {
      for (const part of group.split('.')) {
        if (part) used.add(part);
      }
    }
  }
  return used;
}

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

  // Check if the vindurFn function is exported - if so, don't throw error
  if (isVariableExported(functionName, path)) return false;

  throw new TransformError(
    `vindurFn "${functionName}" must be exported, locally declared vindurFn functions are not supported. `
      + `If you are trying to use a vindurFn function, you must import it from another file.`,
    notNullish(path.node.loc),
    { filename: handlerContext.filePath },
  );
}

export function handleCssVariableAssignment(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex, filePath } = handlerContext;

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

  // Capture location information from the template literal
  const sourceContent = context.state.sourceContent || '';
  const location = createLocationFromTemplateLiteral(
    path.node.init.quasi,
    filePath,
    sourceContent,
  );

  const result = processStyledTemplate(
    path.node.init.quasi,
    context,
    varName,
    'css',
    dev,
    fileHash,
    classIndex.current,
    classIndex,
    location,
  );
  classIndex.current++;

  // Track the CSS variable for future reference
  context.state.cssVariables.set(varName, {
    className: result.finalClassName,
    cssContent: result.cssContent,
  });

  // Emit warnings for scoped variables in dev mode
  if (
    dev
    && result.warnings
    && result.warnings.length > 0
    && context.onWarning
  ) {
    for (const warning of result.warnings) {
      const transformWarning = new TransformWarning(
        warning,
        notNullish(path.node.loc),
        { filename: filePath },
      );
      context.onWarning(transformWarning);
    }
  }

  // Replace the tagged template with the class name string
  path.node.init = t.stringLiteral(result.finalClassName);

  return true;
}

// helper functions moved to ./utils/styled-helpers

export function handleStyledElementAssignment(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex, filePath } = handlerContext;

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

  // Capture location information from the template literal
  const sourceContent = context.state.sourceContent || '';
  const location = createLocationFromTemplateLiteral(
    path.node.init.quasi,
    filePath,
    sourceContent,
  );

  const result = processStyledTemplate(
    path.node.init.quasi,
    context,
    varName,
    `styled.${tagName}`,
    dev,
    fileHash,
    classIndex.current,
    classIndex,
    location,
  );
  classIndex.current++;

  // Emit warnings for scoped variables in dev mode
  if (
    dev
    && result.warnings
    && result.warnings.length > 0
    && context.onWarning
  ) {
    for (const warning of result.warnings) {
      const transformWarning = new TransformWarning(
        warning,
        notNullish(path.node.loc),
        { filename: filePath },
      );
      context.onWarning(transformWarning);
    }
  }

  // Emit warnings for undeclared classes only for plain styled components (not extensions)
  if (dev && context.onWarning && !context.state.vindurImports.has('cx')) {
    const declaredClasses = collectDeclaredStyleClasses(styleFlags);
    const usedClasses = collectUsedClassesFromCss(result.cssContent);
    for (const cls of usedClasses) {
      if (!declaredClasses.has(cls)) {
        const warning = new TransformWarning(
          `The class '${cls}' is used in CSS but not declared in the component`,
          notNullish(path.node.loc),
        );
        context.onWarning(warning);
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
  const attrsExpression = attrs;
  const hasAttrs = !!attrs;

  // Store the styled component mapping
  const isExported = isVariableExported(varName, path);
  // For style flags we now inline local components (no wrapper) unless exported or attrs are present
  const hasIntermediateComponent = isExported || hasAttrs;
  context.state.styledComponents.set(varName, {
    element: tagName,
    className: result.finalClassName,
    isExported,
    styleFlags,
    attrs: hasAttrs,
    attrsExpression,
  });

  // Transform based on whether we have style flags
  if (styleFlags) {
    if (hasIntermediateComponent) {
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
      // Emit warnings for missing modifier styles in dev mode
      if (dev && context.onWarning) {
        const missingSelectors = checkForMissingModifierStyles(
          styleFlags,
          context.state.cssRules,
          result.finalClassName,
        );
        for (const missing of missingSelectors) {
          const warning = new TransformWarning(
            `Warning: Missing modifier styles for "${missing.original}" in ${varName}`,
            notNullish(path.node.loc),
          );
          context.onWarning(warning);
        }
      }
      // Remove the styled component declaration for local components without attrs (inline at usage)
      path.remove();
    }
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
  const { context, dev, fileHash, classIndex, filePath } = handlerContext;

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
      throw new TransformError(
        'styled() can only extend identifiers (components or css variables)',
        notNullish(tag.loc),
        { filename: filePath },
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
      throw new TransformError(
        'styled() can only extend identifiers (components or css variables)',
        notNullish(tag.loc),
        { filename: filePath },
      );
    }
    extendedArg = tag.callee.object.arguments[0];
    if (tag.arguments.length === 1 && t.isObjectExpression(tag.arguments[0])) {
      attrs = tag.arguments[0];
    } else {
      throw new TransformError(
        'styled(Component).attrs() must be called with exactly one object literal argument',
        notNullish(tag.loc),
        { filename: filePath },
      );
    }
  } else {
    return false;
  }

  // Handle styled(Component)`` variable assignments
  const varName = path.node.id.name;
  const extendedName = extendedArg.name;

  // Check if extending a non-component variable
  const extendedInfo = context.state.styledComponents.get(extendedName);
  validateExtendedComponent(extendedName, extendedInfo, path, extendedArg.loc);

  // Check for TypeScript generic type parameters (style flags)
  const typeParameters = path.node.init.typeParameters;
  const styleFlags = extractStyleFlags(typeParameters || null, fileHash, dev);

  // Capture location information from the template literal
  const sourceContent = context.state.sourceContent || '';
  const location = createLocationFromTemplateLiteral(
    path.node.init.quasi,
    filePath,
    sourceContent,
  );

  const result = processStyledExtension(
    path.node.init.quasi,
    context,
    varName,
    extendedName,
    dev,
    fileHash,
    classIndex.current,
    classIndex,
    location,
  );
  classIndex.current++;

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

  // Store the extended styled component mapping
  // Components with attrs should always be treated as having intermediate components
  // Note: result.finalClassName already contains the concatenated class names from processStyledExtension
  const isExported = isVariableExported(varName, path);
  const isExtendingRegularComponent = !extendedInfo;

  // For regular components, we store the component name as the element
  const element = extendedInfo ? extendedInfo.element : extendedName;

  // For style flags we inline local components unless exported or attrs are present
  const hasIntermediateComponent = isExported || hasAttrs;

  context.state.styledComponents.set(varName, {
    element,
    className: result.finalClassName,
    isExported,
    styleFlags,
    attrs: hasAttrs,
    attrsExpression,
  });

  // Transform the styled extension
  transformStyledExtension(
    styleFlags,
    result,
    element,
    isExtendingRegularComponent,
    attrsExpression,
    hasIntermediateComponent,
    varName,
    path,
    context,
    dev,
  );

  return true;
}


// validateExtendedComponent moved to ./utils/styled-helpers

export function handleKeyframesVariableAssignment(
  path: NodePath<t.VariableDeclarator>,
  handlerContext: VariableHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex, filePath } = handlerContext;

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

  // Capture location information from the template literal
  const sourceContent = context.state.sourceContent || '';
  const location = createLocationFromTemplateLiteral(
    path.node.init.quasi,
    filePath,
    sourceContent,
  );

  const result = processKeyframes(
    path.node.init.quasi,
    context,
    varName,
    dev,
    fileHash,
    classIndex.current,
    location,
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
  handleDynamicCssColorAssignment,
  handleGlobalStyleVariableAssignment,
  handleStaticThemeColorsAssignment,
  handleWithComponentAssignment,
} from './additional-variable-handlers';
export {
  handleCreateClassNameCall,
  handleStableIdCall,
} from './call-expression-handlers';
