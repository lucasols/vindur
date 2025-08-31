import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import type { ImportedFunctions, VindurPluginState } from './babel-plugin';
import { TransformError } from './custom-errors';

type PostProcessingContext = {
  state: VindurPluginState;
  importedFunctions: ImportedFunctions;
  usedFunctions: Set<string>;
  importAliasesArray: [string, string][];
};

export function resolveForwardReferences(
  state: VindurPluginState,
  filePath: string,
): void {
  const defaultLoc: t.SourceLocation = {
    start: { line: 1, column: 0, index: 0 },
    end: { line: 1, column: 0, index: 0 },
    filename: filePath,
    identifierName: undefined,
  };
  state.cssRules = state.cssRules.map((cssRuleObj) => {
    const cssRule = cssRuleObj.css;
    let resolvedRule = cssRule;
    // Find all forward reference placeholders
    const forwardRefRegex = /__FORWARD_REF__(\w+)__/g;
    let match;
    while ((match = forwardRefRegex.exec(cssRule)) !== null) {
      const componentName = match[1];
      if (!componentName) {
        throw new TransformError(
          'Invalid forward reference placeholder found',
          defaultLoc,
          filePath,
        );
      }
      const styledComponent = state.styledComponents.get(componentName);
      if (styledComponent) {
        // Replace the placeholder with the actual class name
        resolvedRule = resolvedRule.replace(
          match[0],
          `.${styledComponent.className}`,
        );
      } else {
        throw new TransformError(
          `Forward reference to undefined styled component: ${componentName}. Make sure the component is defined in the same file.`,
          defaultLoc,
          filePath,
        );
      }
    }
    return { ...cssRuleObj, css: resolvedRule };
  });
}

type ImportSpecifierInfo = {
  name: string;
  hasImport: boolean;
  specifier?: t.ImportSpecifier;
};

const importNames = [
  'cx',
  'mergeClassNames',
  'mergeStyles',
  '_vSC',
  'createDynamicCssColor',
  '_vCWM',
  'vindurFn',
];

function processVindurSpecifiers(
  specifiers: t.ImportDeclaration['specifiers'],
  state: VindurPluginState,
): {
  keepSpecifiers: t.ImportSpecifier[];
  importInfo: Record<string, ImportSpecifierInfo>;
} {
  const importInfo: Record<string, ImportSpecifierInfo> = {};
  const keepSpecifiers: t.ImportSpecifier[] = [];

  // Initialize import info
  for (const name of importNames) {
    importInfo[name] = { name, hasImport: false };
  }

  // Process existing specifiers
  for (const specifier of specifiers) {
    if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) {
      const importedName = specifier.imported.name;

      if (importInfo[importedName]) {
        importInfo[importedName].hasImport = true;
        importInfo[importedName].specifier = specifier;

        if (state.vindurImports.has(importedName)) {
          keepSpecifiers.push(specifier);
        }
      }
    }
  }

  return { keepSpecifiers, importInfo };
}

function addMissingImports(
  keepSpecifiers: t.ImportSpecifier[],
  importInfo: Record<string, ImportSpecifierInfo>,
  state: VindurPluginState,
): t.ImportSpecifier[] {
  const result = [...keepSpecifiers];

  for (const info of Object.values(importInfo)) {
    if (state.vindurImports.has(info.name) && !info.hasImport) {
      result.push(
        t.importSpecifier(t.identifier(info.name), t.identifier(info.name)),
      );
    }
  }

  return result;
}

export function handleVindurImportCleanup(
  path: NodePath<t.ImportDeclaration>,
  state: VindurPluginState,
): boolean {
  const source = path.node.source.value;
  if (source !== 'vindur') return false;

  const { keepSpecifiers, importInfo } = processVindurSpecifiers(
    path.node.specifiers,
    state,
  );

  const finalSpecifiers = addMissingImports(keepSpecifiers, importInfo, state);

  if (finalSpecifiers.length > 0) {
    path.node.specifiers = finalSpecifiers;
  } else {
    path.remove();
  }

  return true;
}

export function handleFunctionImportCleanup(
  path: NodePath<t.ImportDeclaration>,
  context: PostProcessingContext,
): boolean {
  const source = path.node.source.value;

  // Check if this is a relative import or an alias import that was resolved
  const isRelativeImport = source.startsWith('./') || source.startsWith('../');
  const resolvedPath = resolveImportPath(source, context.importAliasesArray);
  const isResolvedAliasImport = resolvedPath !== null;

  if (!isRelativeImport && !isResolvedAliasImport) {
    return false;
  }

  // Filter out unused function imports and dynamic color imports
  const unusedSpecifiers: t.ImportSpecifier[] = [];
  const usedSpecifiers: t.ImportSpecifier[] = [];

  for (const specifier of path.node.specifiers) {
    if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) {
      const importedName = specifier.imported.name;
      const localName = specifier.local.name;

      // Remove functions that were used during CSS processing (they're compiled away)
      if (
        context.importedFunctions.has(importedName)
        && context.usedFunctions.has(importedName)
      ) {
        unusedSpecifiers.push(specifier);
      }
      // Remove dynamic colors that were imported and used (they're compiled away)
      else if (context.state.dynamicColors?.has(localName)) {
        unusedSpecifiers.push(specifier);
      } else {
        usedSpecifiers.push(specifier);
      }
    } else if (t.isImportSpecifier(specifier)) {
      usedSpecifiers.push(specifier);
    }
  }

  if (unusedSpecifiers.length > 0) {
    if (usedSpecifiers.length === 0) {
      // Remove the entire import statement if no functions are used
      path.remove();
    } else {
      // Remove only unused specifiers
      path.node.specifiers = usedSpecifiers;
    }
  }

  return true;
}

export function cleanupImports(
  file: { path: NodePath },
  context: PostProcessingContext,
): void {
  file.path.traverse({
    ImportDeclaration(path) {
      // Try vindur imports first
      if (handleVindurImportCleanup(path, context.state)) {
        return;
      }

      // Then try function imports
      handleFunctionImportCleanup(path, context);
    },
  });
}

export function performPostProcessing(
  file: { path: NodePath },
  context: PostProcessingContext,
  filePath: string,
): void {
  // Step 1: Resolve forward references in CSS rules
  resolveForwardReferences(context.state, filePath);

  // Step 2: Clean up imports
  cleanupImports(file, context);
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
