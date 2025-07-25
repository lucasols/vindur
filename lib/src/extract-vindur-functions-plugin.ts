import type { PluginObj } from '@babel/core';
import { types as t } from '@babel/core';
import type { DebugLogger, FunctionCache } from './babel-plugin';
import { parseFunction } from './function-parser';

export function createExtractVindurFunctionsPlugin(
  filePath: string,
  compiledFunctions: FunctionCache,
  debug?: DebugLogger,
): PluginObj {
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

                debug?.log(
                  `[vindur:cache] Cached function "${name}" in ${filePath}`,
                );
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
