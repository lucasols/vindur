import type { PluginObj } from '@babel/core';
import { types as t } from '@babel/core';
import type { VindurPluginState } from './babel-plugin';
import { parseFunction } from './function-parser';


export function createExtractVindurFunctionsPlugin(
  filePath: string,
  compiledFunctions: VindurPluginState['compiledFunctions'],
): PluginObj {
  return {
    pre() {
      // Ensure the file entry exists even if no vindurFn functions are found
      compiledFunctions[filePath] ??= {};
    },
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
              && declarator.init.callee.name === 'vindurFn'
              && declarator.init.arguments.length === 1
            ) {
              const arg = declarator.init.arguments[0];
              if (
                t.isArrowFunctionExpression(arg)
                || t.isFunctionExpression(arg)
              ) {
                const name = declarator.id.name;
                const compiledFn = parseFunction(arg, name);

                compiledFunctions[filePath] ??= {};
                compiledFunctions[filePath][name] = compiledFn;
              } else {
                throw new Error(
                  `vindurFn must be called with a function expression, got ${typeof arg} in function "${declarator.id.name}"`,
                );
              }
            }
          }
        }
      },
    },
  };
}
