import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import generate from '@babel/generator';
import { parseFunction } from './function-parser';
import type { 
  DebugLogger, 
  VindurPluginState, 
  FunctionCache, 
  ImportedFunctions 
} from './babel-plugin';
import type { CssProcessingContext } from './css-processing';
import {
  processStyledTemplate,
  processStyledExtension,
  processGlobalStyle,
  processKeyframes,
} from './css-processing';

type ImportHandlerContext = {
  state: VindurPluginState;
  importedFunctions: ImportedFunctions;
  debug?: DebugLogger;
  importAliasesArray: [string, string][];
};

type ExportHandlerContext = {
  transformFunctionCache: FunctionCache;
  filePath: string;
};

type VariableHandlerContext = {
  context: CssProcessingContext;
  dev: boolean;
  fileHash: string;
  classIndex: { current: number };
};

type TaggedTemplateHandlerContext = {
  context: CssProcessingContext;
  dev: boolean;
  fileHash: string;
  classIndex: { current: number };
};

export function handleVindurImports(
  path: NodePath<t.ImportDeclaration>,
  handlerContext: ImportHandlerContext,
): void {
  const { state } = handlerContext;
  
  for (const specifier of path.node.specifiers) {
    if (
      t.isImportSpecifier(specifier)
      && t.isIdentifier(specifier.imported)
    ) {
      state.vindurImports.add(specifier.imported.name);
    }
  }
  // Don't remove the import statement immediately - we'll handle it in post()
  path.skip();
}

export function handleFunctionImports(
  path: NodePath<t.ImportDeclaration>,
  handlerContext: ImportHandlerContext,
): void {
  const { importedFunctions, debug, importAliasesArray } = handlerContext;
  
  const source = path.node.source.value;
  if (typeof source !== 'string') return;

  const resolvedPath = resolveImportPath(source, importAliasesArray);
  
  if (resolvedPath === null) {
    debug?.log(
      `[vindur:import] ${source} is not an alias import, skipping`,
    );
    return;
  }

  debug?.log(`[vindur:import] ${source} resolved to ${resolvedPath}`);

  for (const specifier of path.node.specifiers) {
    if (
      t.isImportSpecifier(specifier)
      && t.isIdentifier(specifier.imported)
    ) {
      importedFunctions.set(specifier.imported.name, resolvedPath);
    }
  }
}

export function handleVindurFnExport(
  path: NodePath<t.ExportNamedDeclaration>,
  handlerContext: ExportHandlerContext,
): void {
  const { transformFunctionCache, filePath } = handlerContext;
  
  if (!path.node.declaration || !t.isVariableDeclaration(path.node.declaration)) {
    return;
  }

  for (const declarator of path.node.declaration.declarations) {
    if (
      t.isVariableDeclarator(declarator)
      && t.isIdentifier(declarator.id)
      && declarator.init
      && t.isCallExpression(declarator.init)
      && t.isIdentifier(declarator.init.callee)
      && declarator.init.callee.name === 'vindurFn'
      && declarator.init.arguments.length === 1
    ) {
      const arg = declarator.init.arguments[0];
      if (
        t.isArrowFunctionExpression(arg)
        || t.isFunctionExpression(arg)
      ) {
        const functionName = declarator.id.name;
        const compiledFn = parseFunction(arg, functionName);

        transformFunctionCache[filePath] ??= {};
        transformFunctionCache[filePath][functionName] = compiledFn;
      } else {
        throw new Error(
          `vindurFn must be called with a function expression, got ${typeof arg} in function "${declarator.id.name}"`,
        );
      }
    }
  }
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
  context.state.styledComponents.set(varName, {
    element: tagName,
    className: result.finalClassName,
  });

  // Remove the styled component declaration
  path.remove();
  
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
  context.state.styledComponents.set(varName, {
    element: extendedInfo.element,
    className: result.finalClassName,
  });

  // Remove the styled component declaration
  path.remove();
  
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

export function handleCssTaggedTemplate(
  path: NodePath<t.TaggedTemplateExpression>,
  handlerContext: TaggedTemplateHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex } = handlerContext;
  
  if (
    !context.state.vindurImports.has('css')
    || !t.isIdentifier(path.node.tag)
    || path.node.tag.name !== 'css'
  ) {
    return false;
  }

  const result = processStyledTemplate(
    path.node.quasi,
    context,
    undefined,
    'css',
    dev,
    fileHash,
    classIndex.current,
  );
  classIndex.current++;

  // Replace the tagged template with the class name string
  path.replaceWith(t.stringLiteral(result.finalClassName));
  
  return true;
}

export function handleKeyframesTaggedTemplate(
  path: NodePath<t.TaggedTemplateExpression>,
  handlerContext: TaggedTemplateHandlerContext,
): boolean {
  const { context, dev, fileHash, classIndex } = handlerContext;
  
  if (
    !context.state.vindurImports.has('keyframes')
    || !t.isIdentifier(path.node.tag)
    || path.node.tag.name !== 'keyframes'
  ) {
    return false;
  }

  const result = processKeyframes(
    path.node.quasi,
    context,
    undefined,
    dev,
    fileHash,
    classIndex.current,
  );
  classIndex.current++;

  // Replace the tagged template with the animation name string
  path.replaceWith(t.stringLiteral(result.finalClassName));
  
  return true;
}

export function handleGlobalStyleTaggedTemplate(
  path: NodePath<t.TaggedTemplateExpression>,
  handlerContext: TaggedTemplateHandlerContext,
): boolean {
  const { context } = handlerContext;
  
  if (
    !context.state.vindurImports.has('createGlobalStyle')
    || !t.isIdentifier(path.node.tag)
    || path.node.tag.name !== 'createGlobalStyle'
  ) {
    return false;
  }

  processGlobalStyle(path.node.quasi, context);

  // Remove createGlobalStyle expression since it produces no output
  if (t.isExpressionStatement(path.parent)) {
    // Remove the entire expression statement
    path.parentPath.remove();
  } else {
    // If it's part of another expression, replace with void 0
    path.replaceWith(t.unaryExpression('void', t.numericLiteral(0)));
  }
  
  return true;
}

export function handleInlineStyledError(
  path: NodePath<t.TaggedTemplateExpression>,
  context: { state: VindurPluginState },
): boolean {
  if (
    !context.state.vindurImports.has('styled')
    || !t.isMemberExpression(path.node.tag)
    || !t.isIdentifier(path.node.tag.object)
    || path.node.tag.object.name !== 'styled'
    || !t.isIdentifier(path.node.tag.property)
  ) {
    return false;
  }

  // For inline styled usage, we can't directly map it
  // So we keep it as an error or handle it differently
  throw new Error(
    'Inline styled component usage is not supported. Please assign styled components to a variable first.',
  );
}

export function handleJsxStyledComponent(
  path: NodePath<t.JSXElement>,
  context: { state: VindurPluginState },
): boolean {
  if (!t.isJSXIdentifier(path.node.openingElement.name)) {
    return false;
  }

  const elementName = path.node.openingElement.name.name;
  const styledInfo = context.state.styledComponents.get(elementName);

  if (!styledInfo) {
    return false;
  }

  // Replace the styled component with the actual HTML element
  path.node.openingElement.name = t.jsxIdentifier(styledInfo.element);
  if (path.node.closingElement) {
    path.node.closingElement.name = t.jsxIdentifier(styledInfo.element);
  }

  handleJsxClassNameMerging(path, styledInfo, context);
  
  return true;
}

function handleJsxClassNameMerging(
  path: NodePath<t.JSXElement>,
  styledInfo: { element: string; className: string },
  context: { state: VindurPluginState },
): void {
  // Check for spread attributes
  const attributes = path.node.openingElement.attributes;
  const spreadAttrs = attributes.filter(
    (attr): attr is t.JSXSpreadAttribute =>
      t.isJSXSpreadAttribute(attr),
  );

  // Validate spread expressions - only allow simple identifiers
  for (const attr of spreadAttrs) {
    if (!t.isIdentifier(attr.argument)) {
      const expressionCode = generate(attr.argument).code;
      throw new Error(
        `Unsupported spread expression "${expressionCode}" used in vindur styled component. Only references to variables are allowed in spread expressions. Extract them to a variable and use that variable in the spread expression.`,
      );
    }
  }
  
  const classNameAttrs = attributes.filter(
    (attr): attr is t.JSXAttribute =>
      t.isJSXAttribute(attr)
      && t.isJSXIdentifier(attr.name)
      && attr.name.name === 'className',
  );
  const existingClassNameAttr = classNameAttrs[classNameAttrs.length - 1]; // Get the last className attr

  if (spreadAttrs.length > 0) {
    handleClassNameWithSpreads(
      attributes,
      spreadAttrs,
      existingClassNameAttr,
      classNameAttrs,
      styledInfo,
      context,
    );
  } else {
    handleClassNameWithoutSpreads(
      attributes,
      existingClassNameAttr,
      styledInfo,
    );
  }
}

function handleClassNameWithSpreads(
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  spreadAttrs: t.JSXSpreadAttribute[],
  existingClassNameAttr: t.JSXAttribute | undefined,
  classNameAttrs: t.JSXAttribute[],
  styledInfo: { element: string; className: string },
  context: { state: VindurPluginState },
): void {
  // Find the last spread index
  const lastSpreadIndex = Math.max(
    ...spreadAttrs.map((attr) => attributes.indexOf(attr)),
  );

  // Only apply mergeWithSpread logic to the final className attribute
  if (existingClassNameAttr) {
    const finalClassNameIndex = attributes.indexOf(existingClassNameAttr);
    const hasSpreadsBeforeFinalClassName = lastSpreadIndex < finalClassNameIndex;
    const hasMultipleClassNames = classNameAttrs.length > 1;

    if (
      hasSpreadsBeforeFinalClassName
      && !hasMultipleClassNames
      && t.isStringLiteral(existingClassNameAttr.value)
    ) {
      // Single className comes after spreads - static merge, no mergeWithSpread needed
      existingClassNameAttr.value.value = `${styledInfo.className} ${existingClassNameAttr.value.value}`;
    } else {
      // Multiple classNames OR final className comes before/among spreads - needs mergeWithSpread
      createMergeWithSpreadCall(
        existingClassNameAttr,
        spreadAttrs,
        styledInfo,
        context,
      );
    }
  } else {
    // No existing className - add one with mergeWithSpread
    createMergeWithSpreadCall(
      undefined,
      spreadAttrs,
      styledInfo,
      context,
      attributes,
    );
  }
}

function handleClassNameWithoutSpreads(
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  existingClassNameAttr: t.JSXAttribute | undefined,
  styledInfo: { element: string; className: string },
): void {
  if (existingClassNameAttr) {
    // Merge with existing className
    if (t.isStringLiteral(existingClassNameAttr.value)) {
      // If it's a string literal, concatenate
      existingClassNameAttr.value.value = `${styledInfo.className} ${existingClassNameAttr.value.value}`;
    } else if (t.isJSXExpressionContainer(existingClassNameAttr.value)) {
      // If it's an expression, create a template literal
      existingClassNameAttr.value = t.jsxExpressionContainer(
        t.templateLiteral(
          [
            t.templateElement(
              {
                cooked: `${styledInfo.className} `,
                raw: `${styledInfo.className} `,
              },
              false,
            ),
            t.templateElement({ cooked: '', raw: '' }, true),
          ],
          [
            t.isJSXEmptyExpression(existingClassNameAttr.value.expression)
              ? t.stringLiteral('')
              : existingClassNameAttr.value.expression,
          ],
        ),
      );
    }
  } else {
    // Add new className attribute
    attributes.push(
      t.jsxAttribute(
        t.jsxIdentifier('className'),
        t.stringLiteral(styledInfo.className),
      ),
    );
  }
}

function createMergeWithSpreadCall(
  existingClassNameAttr: t.JSXAttribute | undefined,
  spreadAttrs: t.JSXSpreadAttribute[],
  styledInfo: { element: string; className: string },
  context: { state: VindurPluginState },
  attributes?: (t.JSXAttribute | t.JSXSpreadAttribute)[],
): void {
  context.state.vindurImports.add('mergeWithSpread');

  // Build the spread props array
  const spreadPropsArray = spreadAttrs.map((attr) => attr.argument);

  if (existingClassNameAttr) {
    // Include the final className value in the base
    let baseClassName = styledInfo.className;
    if (t.isStringLiteral(existingClassNameAttr.value)) {
      baseClassName = `${styledInfo.className} ${existingClassNameAttr.value.value}`;
    }

    // Create the mergeWithSpread call
    const mergeCall = t.callExpression(
      t.identifier('mergeWithSpread'),
      [
        t.arrayExpression(spreadPropsArray),
        t.stringLiteral(baseClassName),
      ],
    );

    // Replace the final className with merge call
    existingClassNameAttr.value = t.jsxExpressionContainer(mergeCall);
  } else if (attributes) {
    // No existing className - add one with mergeWithSpread
    const mergeCall = t.callExpression(
      t.identifier('mergeWithSpread'),
      [
        t.arrayExpression(spreadPropsArray),
        t.stringLiteral(styledInfo.className),
      ],
    );

    attributes.push(
      t.jsxAttribute(
        t.jsxIdentifier('className'),
        t.jsxExpressionContainer(mergeCall),
      ),
    );
  }
}

// Helper function - moved from main file
function resolveImportPath(
  source: string,
  importAliases: [string, string][],
): string | null {
  // Check for alias imports
  for (const [alias, aliasPath] of importAliases) {
    if (source.startsWith(alias)) {
      const resolvedPath = source.replace(alias, aliasPath);
      return `${resolvedPath}.ts`;
    }
  }

  // Return as-is for all other imports (relative, absolute, or package imports)
  return null;
}