import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import type { VindurPluginState } from '../babel-plugin';

type CallExpressionContext = {
  state: VindurPluginState;
  dev: boolean;
  fileHash: string;
  classIndex: () => number;
};

export function handleStableIdCall(
  path: NodePath<t.CallExpression>,
  context: CallExpressionContext,
): boolean {
  if (
    !context.state.vindurImports.has('stableId')
    || !t.isIdentifier(path.node.callee)
    || path.node.callee.name !== 'stableId'
  ) {
    return false;
  }

  // Get variable name for dev mode from parent VariableDeclarator if present
  let varName: string | undefined;
  if (
    t.isVariableDeclarator(path.parent)
    && t.isIdentifier(path.parent.id)
    && path.parent.init === path.node
  ) {
    varName = path.parent.id.name;
  }

  // Generate a hash similar to css`` - use fileHash and classIndex
  const classIndex = context.classIndex();
  const hash =
    context.dev && varName ?
      `${context.fileHash}-${varName}-${classIndex}`
    : `${context.fileHash}-${classIndex}`;

  // Replace the call with a string literal
  path.replaceWith(t.stringLiteral(hash));

  return true;
}

export function handleCreateClassNameCall(
  path: NodePath<t.CallExpression>,
  context: CallExpressionContext,
): boolean {
  if (
    !context.state.vindurImports.has('createClassName')
    || !t.isIdentifier(path.node.callee)
    || path.node.callee.name !== 'createClassName'
    || path.node.arguments.length > 0 // Skip if already has arguments (already processed)
  ) {
    return false;
  }

  // Check if this is a valid usage pattern
  validateCreateClassNameUsage(path);

  // Get variable name for dev mode from parent VariableDeclarator if present
  let varName: string | undefined;
  if (
    t.isVariableDeclarator(path.parent)
    && t.isIdentifier(path.parent.id)
    && path.parent.init === path.node
  ) {
    varName = path.parent.id.name;
  }

  // Generate a hash similar to css`` - use fileHash and classIndex
  const classIndex = context.classIndex();
  const hash =
    context.dev && varName ?
      `${context.fileHash}-${varName}-${classIndex}`
    : `${context.fileHash}-${classIndex}`;

  // Replace the call with createClassName(hash)
  path.replaceWith(
    t.callExpression(t.identifier('createClassName'), [t.stringLiteral(hash)]),
  );

  return true;
}

function validateCreateClassNameUsage(path: NodePath<t.CallExpression>): void {
  const parent = path.parent;

  // Check if it's being destructured
  if (t.isVariableDeclarator(parent) && t.isObjectPattern(parent.id)) {
    throw new Error(
      'createClassName() cannot be used with destructuring assignment. Use a regular variable assignment instead.',
    );
  }

  // Check if it's at module root level
  if (t.isVariableDeclarator(parent)) {
    // Walk up to find the variable declaration
    let currentPath: NodePath | null = path.parentPath;
    while (currentPath && !t.isVariableDeclaration(currentPath.node)) {
      currentPath = currentPath.parentPath;
    }

    if (currentPath) {
      // Check if the variable declaration is at the top level (program body)
      const declarationParent = currentPath.parent;
      if (
        !t.isProgram(declarationParent)
        && !t.isExportNamedDeclaration(declarationParent)
      ) {
        throw new Error(
          'createClassName() can only be used in variable declarations at the module root level.',
        );
      }
    }
  } else {
    // If it's not in a variable declarator, it's inline usage
    throw new Error(
      'createClassName() can only be used in variable declarations at the module root level, not inline.',
    );
  }
}