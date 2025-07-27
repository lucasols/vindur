import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import { parseFunction } from '../function-parser';
import type { 
  DebugLogger, 
  VindurPluginState, 
  FunctionCache, 
  ImportedFunctions 
} from '../babel-plugin';

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

// Helper function to resolve import paths
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