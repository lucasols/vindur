import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import type {
  DebugLogger,
  DynamicColorCache,
  FunctionCache,
  ImportedFunctions,
  VindurPluginState,
} from '../babel-plugin';
import { loadExternalDynamicColors } from '../babel-plugin';
import { TransformError } from '../custom-errors';
import { parseFunction } from '../function-parser';

type ImportHandlerContext = {
  state: VindurPluginState;
  importedFunctions: ImportedFunctions;
  debug?: DebugLogger;
  importAliasesArray: [string, string][];
  fileHash: string;
  classIndex: { current: number };
  fs: { readFile: (path: string) => string };
  dynamicColorCache: DynamicColorCache;
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
    if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) {
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
  const {
    state,
    importedFunctions,
    debug,
    importAliasesArray,
    fs,
    dynamicColorCache,
  } = handlerContext;

  const source = path.node.source.value;

  const resolvedPath = resolveImportPath(source, importAliasesArray);

  if (resolvedPath === null) {
    debug?.log(`[vindur:import] ${source} is not an alias import, skipping`);
    return;
  }

  debug?.log(`[vindur:import] ${source} resolved to ${resolvedPath}`);

  // Load external dynamic colors from this file
  loadExternalDynamicColors(
    fs,
    resolvedPath,
    dynamicColorCache,
    state.styleDependencies,
    debug,
  );

  for (const specifier of path.node.specifiers) {
    if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) {
      const importedName = specifier.imported.name;
      const localName = specifier.local.name;

      importedFunctions.set(importedName, resolvedPath);

      // Track this as a dependency for hot-reload
      if (state.styleDependencies) {
        state.styleDependencies.add(resolvedPath);
        debug?.log(`[vindur:deps] Added import dependency: ${resolvedPath}`);
      }

      // Check if this is a dynamic color and add it to state if so
      const cachedColors = dynamicColorCache[resolvedPath];
      if (cachedColors?.[importedName]) {
        // Initialize dynamicColors map if it doesn't exist
        if (!state.dynamicColors) {
          state.dynamicColors = new Map();
        }

        // Use the hash ID from the external file
        const externalHashId = cachedColors[importedName];
        state.dynamicColors.set(localName, externalHashId);

        debug?.log(
          `[vindur:dynamic-color] Imported dynamic color: ${localName} -> ${externalHashId} (from ${resolvedPath})`,
        );
      }
    }
  }
}

export function handleVindurFnExport(
  path: NodePath<t.ExportNamedDeclaration>,
  handlerContext: ExportHandlerContext,
): void {
  const { transformFunctionCache, filePath } = handlerContext;

  if (
    !path.node.declaration
    || !t.isVariableDeclaration(path.node.declaration)
  ) {
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
      if (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg)) {
        const functionName = declarator.id.name;
        const compiledFn = parseFunction(arg, functionName);

        transformFunctionCache[filePath] ??= {};
        transformFunctionCache[filePath][functionName] = compiledFn;
      } else {
        throw new TransformError(
          `vindurFn must be called with a function expression, got ${typeof arg} in function "${declarator.id.name}"`,
          null,
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
