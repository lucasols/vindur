import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import type { 
  VindurPluginState, 
  ImportedFunctions 
} from './babel-plugin';

type PostProcessingContext = {
  state: VindurPluginState;
  importedFunctions: ImportedFunctions;
  usedFunctions: Set<string>;
  importAliasesArray: [string, string][];
};

export function resolveForwardReferences(state: VindurPluginState): void {
  state.cssRules = state.cssRules.map(cssRule => {
    let resolvedRule = cssRule;
    // Find all forward reference placeholders
    const forwardRefRegex = /__FORWARD_REF__(\w+)__/g;
    let match;
    while ((match = forwardRefRegex.exec(cssRule)) !== null) {
      const componentName = match[1];
      if (!componentName) {
        throw new Error('Invalid forward reference placeholder found');
      }
      const styledComponent = state.styledComponents.get(componentName);
      if (styledComponent) {
        // Replace the placeholder with the actual class name
        resolvedRule = resolvedRule.replace(
          match[0], 
          `.${styledComponent.className}`
        );
      } else {
        throw new Error(
          `Forward reference to undefined styled component: ${componentName}. Make sure the component is defined in the same file.`
        );
      }
    }
    return resolvedRule;
  });
}

export function handleVindurImportCleanup(
  path: NodePath<t.ImportDeclaration>,
  state: VindurPluginState,
): boolean {
  const source = path.node.source.value;
  if (source !== 'vindur') {
    return false;
  }

  // Handle vindur imports - keep only runtime functions if they're used
  const specifiersToKeep: t.ImportSpecifier[] = [];
  let hasMergeWithSpread = false;
  let hasStyledComponent = false;

  for (const specifier of path.node.specifiers) {
    if (
      t.isImportSpecifier(specifier)
      && t.isIdentifier(specifier.imported)
    ) {
      const importedName = specifier.imported.name;
      
      if (importedName === 'mergeWithSpread') {
        hasMergeWithSpread = true;
        if (state.vindurImports.has('mergeWithSpread')) {
          specifiersToKeep.push(specifier);
        }
      } else if (importedName === 'styledComponent') {
        hasStyledComponent = true;
        if (state.vindurImports.has('styledComponent')) {
          specifiersToKeep.push(specifier);
        }
      }
    }
  }

  // Add mergeWithSpread import if needed but not already present
  if (
    state.vindurImports.has('mergeWithSpread')
    && !hasMergeWithSpread
  ) {
    specifiersToKeep.push(
      t.importSpecifier(
        t.identifier('mergeWithSpread'),
        t.identifier('mergeWithSpread'),
      ),
    );
  }

  // Add styledComponent import if needed but not already present
  if (
    state.vindurImports.has('styledComponent')
    && !hasStyledComponent
  ) {
    specifiersToKeep.push(
      t.importSpecifier(
        t.identifier('styledComponent'),
        t.identifier('styledComponent'),
      ),
    );
  }

  if (specifiersToKeep.length > 0) {
    // Keep the import but only with the needed specifiers
    path.node.specifiers = specifiersToKeep;
  } else {
    // Remove the entire vindur import if nothing is needed
    path.remove();
  }

  return true;
}

export function handleFunctionImportCleanup(
  path: NodePath<t.ImportDeclaration>,
  context: PostProcessingContext,
): boolean {
  const source = path.node.source.value;
  if (typeof source !== 'string') {
    return false;
  }

  // Check if this is a relative import or an alias import that was resolved
  const isRelativeImport = source.startsWith('./') || source.startsWith('../');
  const resolvedPath = resolveImportPath(source, context.importAliasesArray);
  const isResolvedAliasImport = resolvedPath !== null;

  if (!isRelativeImport && !isResolvedAliasImport) {
    return false;
  }

  // Filter out unused function imports
  const unusedSpecifiers: t.ImportSpecifier[] = [];
  const usedSpecifiers: t.ImportSpecifier[] = [];

  for (const specifier of path.node.specifiers) {
    if (
      t.isImportSpecifier(specifier)
      && t.isIdentifier(specifier.imported)
    ) {
      const functionName = specifier.imported.name;
      // Remove functions that were used during CSS processing (they're compiled away)
      if (
        context.importedFunctions.has(functionName)
        && context.usedFunctions.has(functionName)
      ) {
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
      const source = path.node.source.value;
      if (typeof source === 'string') {
        // Try vindur imports first
        if (handleVindurImportCleanup(path, context.state)) {
          return;
        }
        
        // Then try function imports
        handleFunctionImportCleanup(path, context);
      }
    },
  });
}

export function performPostProcessing(
  file: { path: NodePath },
  context: PostProcessingContext,
): void {
  // Step 1: Resolve forward references in CSS rules
  resolveForwardReferences(context.state);
  
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