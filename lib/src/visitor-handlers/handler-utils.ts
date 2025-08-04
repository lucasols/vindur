import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';

// Top-level regex to avoid creating new RegExp objects on each function call
const HEX_REGEX = /^[0-9a-fA-F]+$/;

// Helper function to validate hex colors without alpha
export function isValidHexColorWithoutAlpha(color: string): boolean {
  // Must start with #
  if (!color.startsWith('#')) return false;

  const hex = color.slice(1);

  // Must be either 3 or 6 characters (no alpha channel)
  if (hex.length !== 3 && hex.length !== 6) {
    return false;
  }

  // Must contain only valid hex characters
  return HEX_REGEX.test(hex);
}

// Helper function to check if a variable is exported
export function isVariableExported(
  variableName: string,
  path: NodePath<t.VariableDeclarator>,
): boolean {
  // Check if the variable is part of an export declaration
  const parentPath = path.parentPath;
  if (!t.isVariableDeclaration(parentPath.node)) {
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
          t.isExportSpecifier(specifier)
          && t.isIdentifier(specifier.local)
          && specifier.local.name === variableName
        ) {
          return true;
        }
      }
    } else if (t.isExportDefaultDeclaration(statement)) {
      // Check if it's the default export
      if (
        t.isIdentifier(statement.declaration)
        && statement.declaration.name === variableName
      ) {
        return true;
      }
    }
  }

  return false;
}
