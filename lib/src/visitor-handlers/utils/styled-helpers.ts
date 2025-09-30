import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import type { CssProcessingContext } from '../../css-processing';
import { checkForMissingModifierStyles, type StyleFlag } from '../style-flags-utils';
import { TransformError, TransformWarning } from '../../custom-errors';

export const LOWERCASE_START_REGEX = /^[a-z]/;
export const CAMEL_CASE_REGEX = /^[A-Z]/;

export type StyledElementInfo = {
  tagName: string;
  attrs: t.ObjectExpression | undefined;
};

export function parseStyledElementTag(tag: t.Expression): StyledElementInfo | null {
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
      throw new TransformError(
        'styled.*.attrs() must be called with exactly one object literal argument',
        notNullish(tag.loc),
      );
    }
  }
  return null;
}

export type ExtendedArgInfo = {
  extendedArg: t.Identifier | t.MemberExpression;
  attrs: t.ObjectExpression | undefined;
};

export function extractExtendedArgFromTag(
  tag: t.Expression,
  filePath: string,
): ExtendedArgInfo | null {
  if (
    t.isCallExpression(tag)
    && t.isIdentifier(tag.callee)
    && tag.callee.name === 'styled'
    && tag.arguments.length === 1
  ) {
    // styled(Component)`` or styled(motion.div)``
    const arg = tag.arguments[0];
    if (!t.isIdentifier(arg) && !t.isMemberExpression(arg)) {
      throw new TransformError(
        'styled() can only extend identifiers or member expressions (components or css variables)',
        notNullish(tag.loc),
        { filename: filePath },
      );
    }
    return { extendedArg: arg, attrs: undefined };
  }

  if (
    t.isCallExpression(tag)
    && t.isMemberExpression(tag.callee)
    && t.isCallExpression(tag.callee.object)
    && t.isIdentifier(tag.callee.object.callee)
    && tag.callee.object.callee.name === 'styled'
    && tag.callee.object.arguments.length === 1
    && t.isIdentifier(tag.callee.property)
    && tag.callee.property.name === 'attrs'
  ) {
    // styled(Component).attrs({...})`` or styled(motion.div).attrs({...})``
    const arg = tag.callee.object.arguments[0];
    if (!t.isIdentifier(arg) && !t.isMemberExpression(arg)) {
      throw new TransformError(
        'styled() can only extend identifiers or member expressions (components or css variables)',
        notNullish(tag.loc),
        { filename: filePath },
      );
    }

    if (tag.arguments.length === 1 && t.isObjectExpression(tag.arguments[0])) {
      return { extendedArg: arg, attrs: tag.arguments[0] };
    }

    throw new TransformError(
      'styled(Component).attrs() must be called with exactly one object literal argument',
      notNullish(tag.loc),
      { filename: filePath },
    );
  }

  return null;
}

export function transformStyleFlagsComponent(
  styleFlags: StyleFlag[],
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
    styleFlags.map((styleProp) =>
      t.arrayExpression([
        t.stringLiteral(styleProp.propName),
        t.stringLiteral(styleProp.hashedClassName),
      ]),
    ),
  );

  const args: t.Expression[] = [
    modifierArray,
    t.stringLiteral(result.finalClassName),
    t.stringLiteral(tagName),
  ];

  if (attrsExpression) {
    args.push(attrsExpression);
  }

  path.node.init = t.callExpression(t.identifier('_vCWM'), args);

  // In dev mode, emit warnings for missing modifier styles
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
}

export function transformRegularStyledComponent(
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

export function validateExtendedComponent(
  extendedName: string,
  extendedInfo:
    | {
        element: string;
        className: string;
        isExported: boolean;
        styleFlags?: StyleFlag[];
        attrs?: boolean;
        attrsExpression?: t.ObjectExpression;
      }
    | undefined,
  path: NodePath<t.VariableDeclarator>,
  extendedArgLoc?: t.SourceLocation | null,
): void {
  if (!extendedInfo) {
    // Check if the identifier follows CamelCase convention for components
    if (!CAMEL_CASE_REGEX.test(extendedName)) {
      throw new TransformError(
        `Cannot extend "${extendedName}": component names must start with an uppercase letter (CamelCase).`,
        notNullish(extendedArgLoc),
      );
    }

    // Check if the extended identifier is a valid component
    const binding = path.scope.getBinding(extendedName);
    if (binding?.path.isVariableDeclarator()) {
      const init = binding.path.node.init;
      // If it's initialized with a literal or non-function expression, it's not a component
      if (
        init
        && !t.isFunctionExpression(init)
        && !t.isArrowFunctionExpression(init)
        && !t.isCallExpression(init)
        && !t.isIdentifier(init)
      ) {
        throw new TransformError(
          `Cannot extend "${extendedName}": it is not a component or styled component.`,
          notNullish(extendedArgLoc),
          { ignoreInLint: true },
        );
      }
    }
  }
}

export function transformStyledExtension(
  styleFlags: StyleFlag[] | undefined,
  result: { finalClassName: string },
  element: string,
  isExtendingRegularComponent: boolean,
  attrsExpression: t.ObjectExpression | undefined,
  hasIntermediateComponent: boolean,
  varName: string,
  path: NodePath<t.VariableDeclarator>,
  context: CssProcessingContext,
  dev: boolean,
): void {
  if (styleFlags) {
    if (hasIntermediateComponent) {
      transformStyledExtensionWithStyleFlags(
        styleFlags,
        result,
        element,
        isExtendingRegularComponent,
        attrsExpression,
        varName,
        path,
        context,
        dev,
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
      // Inline at usage for non-exported components without attrs
      path.remove();
    }
  } else if (hasIntermediateComponent) {
    // Transform to _vSC function call for regular styled components
    context.state.vindurImports.add('_vSC');
    const args: t.Expression[] = [
      // Use identifier for custom components, string literal for native elements
      isExtendingRegularComponent || !element.match(LOWERCASE_START_REGEX) ?
        t.identifier(element)
      : t.stringLiteral(element),
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
}

export function transformStyledExtensionWithStyleFlags(
  styleFlags: StyleFlag[],
  result: { finalClassName: string },
  element: string,
  isExtendingRegularComponent: boolean,
  attrsExpression: t.ObjectExpression | undefined,
  varName: string,
  path: NodePath<t.VariableDeclarator>,
  context: CssProcessingContext,
  dev: boolean,
): void {
  // Transform to _vCWM function call for style flags
  context.state.vindurImports.add('_vCWM');

  // Create the modifier array: [["propName", "hashedClassName"], ...]
  const modifierArray = t.arrayExpression(
    styleFlags.map((styleProp) =>
      t.arrayExpression([
        t.stringLiteral(styleProp.propName),
        t.stringLiteral(styleProp.hashedClassName),
      ]),
    ),
  );

  const args: t.Expression[] = [
    modifierArray,
    t.stringLiteral(result.finalClassName),
    // Use identifier for custom components, string literal for native elements
    isExtendingRegularComponent || !element.match(LOWERCASE_START_REGEX) ?
      t.identifier(element)
    : t.stringLiteral(element),
  ];

  if (attrsExpression) {
    args.push(attrsExpression);
  }

  path.node.init = t.callExpression(t.identifier('_vCWM'), args);

  // In dev mode, emit warnings for missing modifier styles
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
}
