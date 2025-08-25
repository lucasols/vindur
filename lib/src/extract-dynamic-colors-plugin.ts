import type { PluginObj } from '@babel/core';
import { types as t } from '@babel/core';
import { murmur2 } from '@ls-stack/utils/hash';
import type { DebugLogger, DynamicColorCache } from './babel-plugin';

export function createExtractDynamicColorsPlugin(
  filePath: string,
  dynamicColorCache: DynamicColorCache,
  debug?: DebugLogger,
): PluginObj {
  // Generate hash for this external file
  const fileHash = `v${murmur2(filePath)}`;
  let idIndex = 1;

  return {
    visitor: {
      ExportNamedDeclaration(path) {
        if (
          path.node.declaration
          && t.isVariableDeclaration(path.node.declaration)
        ) {
          for (const declarator of path.node.declaration.declarations) {
            if (
              t.isVariableDeclarator(declarator)
              && t.isIdentifier(declarator.id)
              && declarator.init
              && t.isCallExpression(declarator.init)
              && t.isIdentifier(declarator.init.callee)
              && declarator.init.callee.name === 'createDynamicCssColor'
              && declarator.init.arguments.length === 0 // No arguments - should be auto-generated
            ) {
              const varName = declarator.id.name;

              // Generate hash ID for this dynamic color in this file
              const hashId = `${fileHash}-${idIndex}`;
              idIndex++;

              // Initialize cache for this file if needed
              dynamicColorCache[filePath] ??= {};

              // Cache the hash ID
              dynamicColorCache[filePath][varName] = hashId;

              debug?.log(
                `[vindur:dynamic-colors] Cached dynamic color "${varName}" -> "${hashId}" in ${filePath}`,
              );
            }
          }
        }
      },
    },
  };
}
