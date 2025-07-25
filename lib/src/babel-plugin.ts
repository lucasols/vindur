import type { NodePath, PluginObj } from '@babel/core';
import { types as t } from '@babel/core';
import generate from '@babel/generator';
import { murmur2 } from '@ls-stack/utils/hash';

export type VindurPluginOptions = { dev?: boolean; filePath: string };

type FunctionValueTypes = 'string' | 'number' | 'boolean';

type TernaryConditionValue =
  | { type: 'string' | 'number' | 'boolean'; value: string | number | boolean }
  | { type: 'arg'; name: string };

type OutputQuasi =
  | { type: 'string'; value: string }
  | { type: 'arg'; name: string }
  | {
      type: 'ternary';
      condition: [
        TernaryConditionValue,
        '===' | '!==' | '>' | '<' | '>=' | '<=',
        TernaryConditionValue,
      ];
      ifTrue: OutputQuasi;
      ifFalse: OutputQuasi;
    };

type FunctionArg = {
  type: FunctionValueTypes;
  defaultValue: string | number | boolean | undefined;
};

export type VindurPluginState = {
  cssRules: string[];
  vindurImports: Set<string>;
  compiledFunctions: {
    [filePath: string]: {
      [functionName: string]:
        | {
            type: 'destructured';
            args: Record<string, FunctionArg>;
            output: OutputQuasi[];
          }
        | { type: 'positional'; args: FunctionArg[]; output: OutputQuasi[] };
    };
  };
};

function processTemplateWithInterpolation(
  quasi: t.TemplateLiteral,
  path: NodePath,
  variableName?: string,
) {
  let cssContent = '';

  // Process template literal with interpolations
  for (let i = 0; i < quasi.quasis.length; i++) {
    // Add the static string part - use cooked value to preserve formatting
    cssContent += quasi.quasis[i]?.value.cooked ?? '';

    // Add the interpolated expression if it exists
    if (i < quasi.expressions.length) {
      const expression = quasi.expressions[i];

      // Handle different types of expressions
      if (t.isIdentifier(expression)) {
        // Try to resolve the variable value at compile time
        const resolvedValue = resolveVariable(expression.name, path);
        if (resolvedValue !== null) {
          cssContent += resolvedValue;
        } else {
          // Throw simple error for unresolvable variables
          const varContext = variableName ? `... ${variableName} = css` : 'css';
          throw new Error(
            `Invalid interpolation used at \`${varContext}\` ... \${${expression.name}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`,
          );
        }
      } else if (t.isStringLiteral(expression)) {
        cssContent += expression.value;
      } else if (t.isNumericLiteral(expression)) {
        cssContent += expression.value.toString();
      } else if (t.isTemplateLiteral(expression)) {
        // Nested template literals - recursively process
        const nested = processTemplateWithInterpolation(
          expression,
          path,
          variableName,
        );
        cssContent += nested.cssContent;
      } else {
        // Generate the source code of the problematic expression
        const expressionSource =
          expression ? generate(expression).code : 'expression';

        const varContext = variableName ? `... ${variableName} = css` : 'css';
        const errorMessage = `Invalid interpolation used at \`${varContext}\` ... \${${expressionSource}}, only references to strings, numbers, or simple arithmetic calculations or simple string interpolations are supported`;
        throw new Error(errorMessage);
      }
    }
  }

  return { cssContent };
}

function resolveVariable(variableName: string, path: NodePath): string | null {
  // Find the variable declaration in the current scope or parent scopes
  const binding = path.scope.getBinding(variableName);

  if (!binding?.path) {
    return null;
  }

  const declarationPath = binding.path;

  // Handle variable declarations
  if (declarationPath.isVariableDeclarator() && declarationPath.node.init) {
    const init = declarationPath.node.init;

    if (t.isStringLiteral(init)) {
      return init.value;
    } else if (t.isNumericLiteral(init)) {
      return init.value.toString();
    } else if (t.isBooleanLiteral(init)) {
      return init.value.toString();
    } else if (t.isBinaryExpression(init)) {
      // Try to resolve simple binary expressions like `margin * 2`
      const resolved = resolveBinaryExpression(init, path);
      return resolved;
    }
  }

  return null;
}

function resolveBinaryExpression(
  expr: t.BinaryExpression,
  path: NodePath,
): string | null {
  const { left, right, operator } = expr;

  let leftValue: number | null = null;
  let rightValue: number | null = null;

  // Resolve left operand
  if (t.isNumericLiteral(left)) {
    leftValue = left.value;
  } else if (t.isIdentifier(left)) {
    const resolved = resolveVariable(left.name, path);
    if (resolved !== null && !isNaN(Number(resolved))) {
      leftValue = Number(resolved);
    }
  }

  // Resolve right operand
  if (t.isNumericLiteral(right)) {
    rightValue = right.value;
  } else if (t.isIdentifier(right)) {
    const resolved = resolveVariable(right.name, path);
    if (resolved !== null && !isNaN(Number(resolved))) {
      rightValue = Number(resolved);
    }
  }

  // Perform the operation if both operands are resolved
  if (leftValue !== null && rightValue !== null) {
    switch (operator) {
      case '+':
        return (leftValue + rightValue).toString();
      case '-':
        return (leftValue - rightValue).toString();
      case '*':
        return (leftValue * rightValue).toString();
      case '/':
        return (leftValue / rightValue).toString();
      default:
        return null;
    }
  }

  return null;
}

export function createVindurPlugin(
  options: VindurPluginOptions,
  state: VindurPluginState,
): PluginObj {
  const { dev = false, filePath } = options;

  // Generate base hash from file path with 'c' prefix
  const fileHash = `c${murmur2(filePath)}`;
  let classIndex = 1;

  return {
    name: 'vindur-css-transform',
    visitor: {
      ImportDeclaration(path) {
        // Track imports from 'vindur' package
        if (path.node.source.value === 'vindur') {
          path.node.specifiers.forEach((specifier) => {
            if (
              t.isImportSpecifier(specifier)
              && t.isIdentifier(specifier.imported)
            ) {
              state.vindurImports.add(specifier.imported.name);
            }
          });
          // Remove the import statement since we're processing the css at build time
          path.remove();
        }
      },
      VariableDeclarator(path) {
        // Check if this is a css tagged template assignment
        if (
          state.vindurImports.has('css')
          && path.node.init
          && t.isTaggedTemplateExpression(path.node.init)
          && t.isIdentifier(path.node.init.tag)
          && path.node.init.tag.name === 'css'
          && t.isIdentifier(path.node.id)
        ) {
          const varName = path.node.id.name;
          const { cssContent } = processTemplateWithInterpolation(
            path.node.init.quasi,
            path,
            varName,
          );

          // Generate class name based on dev mode
          const className =
            dev ?
              `${fileHash}-${classIndex}-${varName}`
            : `${fileHash}-${classIndex}`;
          classIndex++;

          // Store the CSS rule
          state.cssRules.push(`.${className} {\n  ${cssContent.trim()}\n}`);

          // Replace the tagged template with the class name string
          path.node.init = t.stringLiteral(className);
        }
      },
      TaggedTemplateExpression(path) {
        if (
          state.vindurImports.has('css')
          && t.isIdentifier(path.node.tag)
          && path.node.tag.name === 'css'
        ) {
          const { cssContent } = processTemplateWithInterpolation(
            path.node.quasi,
            path,
            undefined,
          );

          // Generate class name with hash and index (no varName for direct usage)
          const className = `${fileHash}-${classIndex}`;
          classIndex++;

          // Store the CSS rule
          state.cssRules.push(`.${className} {\n  ${cssContent.trim()}\n}`);

          // Replace the tagged template with the class name string
          path.replaceWith(t.stringLiteral(className));
        }
      },
    },
    pre() {
      state.cssRules.length = 0;
      state.vindurImports.clear();
      classIndex = 1;
    },
  };
}
