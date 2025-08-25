import { types as t } from '@babel/core';
import { generate } from '@babel/generator';
import { notNullish } from '@ls-stack/utils/assertions';
import { extractLiteralValue, isLiteralExpression } from '../ast-utils';
import type { CssProcessingContext } from '../css-processing';
import {
  resolveDynamicColorCallExpression,
  resolveDynamicColorExpression,
} from './dynamic-colors';
import { getOrExtractFileData } from './file-processing';
import {
  resolveBinaryExpression,
  resolveFunctionCall,
  resolveVariable,
} from './resolution';
import { resolveThemeColorExpression } from './theme-colors';
import { isExtensionResult } from './interpolation.type-guards';
import { TransformError } from '../custom-errors';

function processIdentifierExpression(
  expression: t.Identifier,
  context: CssProcessingContext,
  interpolationContext: {
    isExtension?: boolean;
    dev?: boolean;
  },
  variableName: string | undefined,
  tagType: string,
): string | { type: 'extension'; className: string } {
  // Check if this identifier refers to a styled component
  const styledComponent = context.state.styledComponents.get(expression.name);
  if (styledComponent) return `.${styledComponent.className}`;

  // Check if this identifier refers to a CSS variable
  const cssVariable = context.state.cssVariables.get(expression.name);
  if (cssVariable) {
    if (interpolationContext.isExtension) {
      return { type: 'extension', className: cssVariable };
    } else {
      return `.${cssVariable}`;
    }
  }

  // Check if this identifier refers to a keyframes animation
  const keyframesAnimation = context.state.keyframes.get(expression.name);
  if (keyframesAnimation) return keyframesAnimation;

  // Check imported items
  const importedResult = resolveImportedIdentifier(
    expression.name,
    context,
    interpolationContext,
  );
  if (importedResult !== null) return importedResult;

  // Try local variable resolution
  const resolvedValue = resolveVariable(expression.name, context.path);
  if (resolvedValue !== null) return resolvedValue;

  const varContext =
    variableName ? `... ${variableName} = ${tagType}` : tagType;
  throw new TransformError(
    `Invalid interpolation used at \`${varContext}\` ... \${${expression.name}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations or styled components are supported`,
    notNullish(expression.loc),
  );
}

function resolveImportedIdentifier(
  name: string,
  context: CssProcessingContext,
  interpolationContext: { isExtension?: boolean; dev?: boolean },
): string | { type: 'extension'; className: string } | null {
  // Check if this identifier refers to an imported keyframes
  const importedKeyframes = resolveImportedKeyframes(name, context);
  if (importedKeyframes !== null) return importedKeyframes;

  // Check if this identifier refers to an imported CSS variable
  const importedCss = resolveImportedCss(name, context);
  if (importedCss !== null) {
    if (interpolationContext.isExtension) {
      return { type: 'extension', className: importedCss };
    } else {
      return `.${importedCss}`;
    }
  }

  // Check if this identifier refers to an imported constant
  const importedConstant = resolveImportedConstantLocal(name, context);
  if (importedConstant !== null) {
    return String(importedConstant);
  }

  // If we have an imported function but it wasn't found in any resolver, throw an error
  const importedFilePath = context.importedFunctions.get(name);
  if (importedFilePath) {
    throw new TransformError(
      `Function "${name}" not found in ${importedFilePath}`,
      notNullish(context.path.node.loc),
      importedFilePath,
    );
  }

  return null;
}

function processArrowFunctionExpression(
  expression: t.ArrowFunctionExpression,
  variableName: string | undefined,
  tagType: string,
): string {
  if (
    expression.params.length === 0
    && t.isIdentifier(expression.body)
    && !expression.async
  ) {
    const componentName = expression.body.name;
    return `__FORWARD_REF__${componentName}__`;
  } else {
    const varContext =
      variableName ? `... ${variableName} = ${tagType}` : tagType;
    throw new TransformError(
      `Invalid arrow function in interpolation at \`${varContext}\`. Only simple forward references like \${() => Component} are supported`,
      notNullish(expression.loc),
    );
  }
}

function processCallExpression(
  expression: t.CallExpression,
  context: CssProcessingContext,
  interpolationContext: {
    dev?: boolean;
    position?: { isFirst: boolean; hasNonWhitespaceContent: boolean };
  },
  variableName: string | undefined,
  tagType: string,
): string {
  // Try layer function calls first
  const layerResolved = resolveLayerCall(expression, context);
  if (layerResolved !== null) return layerResolved;

  // Try regular function calls
  const functionResolved = resolveFunctionCall(
    expression,
    context,
    interpolationContext.dev || false,
  );
  if (functionResolved !== null) return functionResolved;

  // Try dynamic color function calls
  const dynamicResolved = resolveDynamicColorCallExpression(
    expression,
    context,
  );
  if (dynamicResolved !== null) return dynamicResolved;

  const expressionSource = generate(expression).code;
  const varContext =
    variableName ? `... ${variableName} = ${tagType}` : tagType;
  throw new TransformError(
    `Unresolved function call at \`${varContext}\` ... \${${expressionSource}}, function must be statically analyzable and correctly imported with the configured aliases`,
    notNullish(expression.loc),
  );
}

function processBinaryExpression(
  expression: t.BinaryExpression,
  context: CssProcessingContext,
  variableName: string | undefined,
  tagType: string,
): string {
  const resolved = resolveBinaryExpression(expression, context.path, context);
  if (resolved !== null) {
    return resolved;
  } else {
    const expressionSource = generate(expression).code;
    const varContext =
      variableName ? `... ${variableName} = ${tagType}` : tagType;
    throw new TransformError(
      `Unresolved binary expression at \`${varContext}\` ... \${${expressionSource}}, only simple arithmetic with constants is supported`,
      notNullish(expression.loc),
    );
  }
}

function resolveCreateClassNameMemberExpression(
  expression: t.MemberExpression,
  context: CssProcessingContext,
): string | null {
  // Check if this is a createClassName(...).selector or createClassName(...).value
  if (
    t.isCallExpression(expression.object)
    && t.isIdentifier(expression.object.callee)
    && expression.object.callee.name === 'createClassName'
    && t.isIdentifier(expression.property)
    && (expression.property.name === 'selector'
      || expression.property.name === 'value')
    && expression.object.arguments.length === 1
    && t.isStringLiteral(expression.object.arguments[0])
  ) {
    const hash = expression.object.arguments[0].value;
    if (expression.property.name === 'selector') return `.${hash}`;
    return hash;
  }

  // Check if this is an identifier.selector or identifier.value where identifier was assigned createClassName()
  if (
    t.isIdentifier(expression.object)
    && t.isIdentifier(expression.property)
    && (expression.property.name === 'selector'
      || expression.property.name === 'value')
  ) {
    // Find the variable binding for the identifier
    const binding = context.path.scope.getBinding(expression.object.name);

    if (
      binding?.path
      && binding.path.isVariableDeclarator()
      && binding.path.node.init
    ) {
      const init = binding.path.node.init;

      // Check if the initialization is a createClassName() call
      if (
        t.isCallExpression(init)
        && t.isIdentifier(init.callee)
        && init.callee.name === 'createClassName'
        && init.arguments.length === 1
        && t.isStringLiteral(init.arguments[0])
      ) {
        const hash = init.arguments[0].value;
        if (expression.property.name === 'selector') return `.${hash}`;
        return hash;
      }
    }
  }

  return null;
}

function processMemberExpression(
  expression: t.MemberExpression,
  context: CssProcessingContext,
  interpolationContext: { dev?: boolean },
  variableName: string | undefined,
  tagType: string,
): string {
  // Try theme colors first
  const themeResolved = resolveThemeColorExpression(
    expression,
    context,
    interpolationContext.dev || false,
  );
  if (themeResolved !== null) return themeResolved;

  // Try dynamic colors
  const dynamicResolved = resolveDynamicColorExpression(expression, context);
  if (dynamicResolved !== null) return dynamicResolved;

  // Try createClassName member expressions
  const createClassNameResolved = resolveCreateClassNameMemberExpression(
    expression,
    context,
  );
  if (createClassNameResolved !== null) return createClassNameResolved;

  // Try object property access
  if (t.isIdentifier(expression.property) && !expression.computed) {
    // Check for nested property access and throw error
    if (t.isMemberExpression(expression.object)) {
      const expressionSource = generate(expression).code;
      const varContext =
        variableName ? `... ${variableName} = ${tagType}` : tagType;
      throw new TransformError(
        `Nested property access is not supported, only one level property access is allowed at \`${varContext}\` ... \${${expressionSource}}`,
        notNullish(expression.loc),
      );
    }

    // Only handle simple identifier.property access
    if (t.isIdentifier(expression.object)) {
      const objectName = expression.object.name;
      const propertyName = expression.property.name;

      const objectPropertyValue = resolveImportedObjectProperty(
        objectName,
        propertyName,
        context,
        notNullish(expression.loc),
      );
      if (objectPropertyValue !== null) {
        return String(objectPropertyValue);
      }
    }
  }

  const expressionSource = generate(expression).code;
  const varContext =
    variableName ? `... ${variableName} = ${tagType}` : tagType;
  throw new TransformError(
    `Invalid interpolation used at \`${varContext}\` ... \${${expressionSource}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
    notNullish(expression.loc),
  );
}

export function processInterpolationExpression(
  expression: t.Expression,
  context: CssProcessingContext,
  variableName: string | undefined,
  tagType: string,
  interpolationContext: {
    isExtension?: boolean;
    dev?: boolean;
    position?: { isFirst: boolean; hasNonWhitespaceContent: boolean };
  } = {},
): string | { type: 'extension'; className: string } {
  if (t.isIdentifier(expression)) {
    return processIdentifierExpression(
      expression,
      context,
      interpolationContext,
      variableName,
      tagType,
    );
  } else if (t.isArrowFunctionExpression(expression)) {
    return processArrowFunctionExpression(expression, variableName, tagType);
  } else if (isLiteralExpression(expression)) {
    const value = extractLiteralValue(expression);
    return String(value);
  } else if (t.isTemplateLiteral(expression)) {
    const nested = processTemplateWithInterpolation(
      expression,
      context,
      variableName,
      tagType,
      interpolationContext.dev || false,
    );
    return nested.cssContent;
  } else if (t.isCallExpression(expression)) {
    return processCallExpression(
      expression,
      context,
      interpolationContext,
      variableName,
      tagType,
    );
  } else if (t.isBinaryExpression(expression)) {
    return processBinaryExpression(expression, context, variableName, tagType);
  } else if (t.isMemberExpression(expression)) {
    return processMemberExpression(
      expression,
      context,
      interpolationContext,
      variableName,
      tagType,
    );
  } else {
    const expressionSource = generate(expression).code;
    const varContext =
      variableName ? `... ${variableName} = ${tagType}` : tagType;
    throw new TransformError(
      `Invalid interpolation used at \`${varContext}\` ... \${${expressionSource}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
      notNullish(expression.loc),
    );
  }
}

export function processTemplateWithInterpolation(
  quasi: t.TemplateLiteral,
  context: CssProcessingContext,
  variableName: string | undefined,
  tagType: string,
  dev: boolean = false,
) {
  let cssContent = '';
  const extensions: string[] = [];
  let hasNonWhitespaceContent = false;

  // Process template literal with interpolations
  for (let i = 0; i < quasi.quasis.length; i++) {
    // Add the static string part - use cooked value to preserve formatting
    const staticPart = quasi.quasis[i]?.value.cooked ?? '';

    // Track if we've encountered non-whitespace content before checking interpolations
    if (staticPart.trim() !== '') {
      hasNonWhitespaceContent = true;
    }

    cssContent += staticPart;

    // Add the interpolated expression if it exists
    if (i < quasi.expressions.length) {
      const expression = quasi.expressions[i];
      if (expression && t.isExpression(expression)) {
        // Check context around interpolation
        const nextPart = quasi.quasis[i + 1]?.value.cooked ?? '';
        const isExtension = nextPart.trimStart().startsWith(';');

        const resolvedExpression = processInterpolationExpression(
          expression,
          context,
          variableName,
          tagType.includes('styled') ? 'styled' : 'css',
          {
            isExtension,
            dev,
            position: { isFirst: i === 0, hasNonWhitespaceContent },
          },
        );

        if (typeof resolvedExpression === 'string') {
          cssContent += resolvedExpression;
          // After processing any interpolation, we have content
          if (resolvedExpression.trim() !== '') {
            hasNonWhitespaceContent = true;
          }
        } else if (isExtensionResult(resolvedExpression)) {
          // Handle extension - store for later class combination
          extensions.push(resolvedExpression.className);
        }
      }
    }
  }

  return { cssContent, extensions };
}

function resolveLayerCall(
  expression: t.CallExpression,
  context: CssProcessingContext,
): string | null {
  // Check if this is a layer function call
  if (
    !context.state.vindurImports.has('layer')
    || !t.isIdentifier(expression.callee)
    || expression.callee.name !== 'layer'
    || expression.arguments.length !== 1
  ) {
    return null;
  }

  const layerArg = expression.arguments[0];
  if (!layerArg || !t.isStringLiteral(layerArg)) {
    throw new TransformError(
      'layer() must be called with a string literal layer name',
      notNullish(layerArg?.loc || context.path.node.loc),
    );
  }

  const layerName = layerArg.value;

  // Return a special marker that will be processed by the CSS processor
  return `__VINDUR_LAYER_START__${layerName}__`;
}

// These are moved from the resolution module to avoid circular imports
function resolveImportedKeyframes(
  keyframesName: string,
  context: CssProcessingContext,
): string | null {
  // Check if this keyframes is imported from another file
  const keyframesFilePath = context.importedFunctions.get(keyframesName);

  if (!keyframesFilePath) return null;

  // Load and process the external file to extract keyframes
  try {
    const extractedData = getOrExtractFileData(keyframesFilePath, context);

    // Look for the specific keyframes in the external file
    const keyframesAnimationName = extractedData.keyframes.get(keyframesName);
    if (keyframesAnimationName) {
      // Mark this keyframes as used (for import cleanup)
      context.usedFunctions.add(keyframesName);
      return keyframesAnimationName;
    }

    // Return null if not found (allow other resolvers to try)
    return null;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new TransformError(
      `Failed to load keyframes "${keyframesName}" from ${keyframesFilePath}`,
      notNullish(context.path.node.loc),
    );
  }
}

function resolveImportedCss(
  cssName: string,
  context: CssProcessingContext,
): string | null {
  // Check if this CSS is imported from another file
  const cssFilePath = context.importedFunctions.get(cssName);

  if (!cssFilePath) return null;

  // Load and process the external file to extract CSS variables
  try {
    const extractedData = getOrExtractFileData(cssFilePath, context);

    // Look for the specific CSS variable in the external file
    const cssClassName = extractedData.cssVariables.get(cssName);
    if (cssClassName) {
      // Mark this CSS as used (for import cleanup)
      context.usedFunctions.add(cssName);
      return cssClassName;
    }

    // Return null if not found (allow other resolvers to try)
    return null;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new TransformError(
      `Failed to load CSS "${cssName}" from ${cssFilePath}`,
      notNullish(context.path.node.loc),
    );
  }
}

function resolveImportedConstantLocal(
  constantName: string,
  context: CssProcessingContext,
): string | number | null {
  // Check if this constant is imported from another file
  const constantFilePath = context.importedFunctions.get(constantName);

  if (!constantFilePath) return null;

  // Load and process the external file to extract constants
  try {
    const extractedData = getOrExtractFileData(constantFilePath, context);

    // Look for the specific constant in the external file
    const constantValue = extractedData.constants.get(constantName);
    if (constantValue !== undefined) {
      // Mark this constant as used (for import cleanup)
      context.usedFunctions.add(constantName);
      return constantValue;
    }

    // Return null if not found (allow other resolvers to try)
    return null;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new TransformError(
      `Failed to load constant "${constantName}" from ${constantFilePath}`,
      notNullish(context.path.node.loc),
    );
  }
}

function resolveImportedObjectProperty(
  objectName: string,
  propertyName: string,
  context: CssProcessingContext,
  loc?: t.SourceLocation | null,
): string | number | null {
  // Check if this object is imported from another file
  const objectFilePath = context.importedFunctions.get(objectName);

  if (!objectFilePath) return null;

  // Load and process the external file to extract objects
  try {
    const extractedData = getOrExtractFileData(objectFilePath, context);

    // Look for the specific object in the external file
    const objectValue = extractedData.objectConstants.get(objectName);
    if (objectValue !== undefined) {
      // Check if the property exists on the object
      const propertyValue = objectValue[propertyName];
      if (propertyValue !== undefined) {
        // Mark this object as used (for import cleanup)
        context.usedFunctions.add(objectName);
        return propertyValue;
      }
    }

    // Return null if not found (allow other resolvers to try)
    return null;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new TransformError(
      `Failed to load object "${objectName}" from ${objectFilePath}`,
      notNullish(loc),
    );
  }
}
