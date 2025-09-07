import { types as t } from '@babel/core';

/**
 * Analyzes a cx() call expression and returns an optimized expression if possible.
 * Returns null if the call cannot be optimized.
 */
export function optimizeCxCall(callExpr: t.CallExpression): t.Expression | null {
  if (!isCxCall(callExpr)) return null;

  const args = callExpr.arguments;
  if (args.length === 0) {
    return t.stringLiteral('');
  }

  // Try full static optimization first
  const staticResult = tryStaticOptimization(args);
  if (staticResult !== null) return staticResult;

  // Try partial optimization
  const partialResult = tryPartialOptimization(args);
  if (partialResult !== null) return partialResult;

  // Cannot optimize
  return null;
}

/**
 * Checks if a call expression is a cx() function call
 */
function isCxCall(callExpr: t.CallExpression): boolean {
  return (
    t.isIdentifier(callExpr.callee) && callExpr.callee.name === 'cx'
  );
}

/**
 * Attempts to fully optimize cx() arguments into a static string
 */
function tryStaticOptimization(args: Array<t.Expression | t.SpreadElement | t.ArgumentPlaceholder>): t.StringLiteral | null {
  const staticClasses: string[] = [];

  for (const arg of args) {
    if (t.isSpreadElement(arg) || t.isArgumentPlaceholder(arg)) {
      return null; // Cannot optimize spreads or placeholders
    }

    const staticValue = getStaticStringValue(arg);
    if (staticValue === null) {
      return null; // Non-static argument found
    }

    if (staticValue !== '') {
      staticClasses.push(staticValue);
    }
  }

  // All arguments are static, join them
  return t.stringLiteral(staticClasses.join(' '));
}

/**
 * Attempts to partially optimize cx() arguments into an optimized expression
 */
function tryPartialOptimization(args: Array<t.Expression | t.SpreadElement | t.ArgumentPlaceholder>): t.Expression | null {
  const parts: t.Expression[] = [];
  let hasOptimizations = false;

  for (const arg of args) {
    if (t.isSpreadElement(arg) || t.isArgumentPlaceholder(arg)) {
      return null; // Cannot optimize spreads or placeholders
    }

    const staticValue = getStaticStringValue(arg);
    if (staticValue !== null) {
      // Static string - can be optimized
      if (staticValue !== '') {
        if (parts.length === 0) {
          parts.push(t.stringLiteral(staticValue));
        } else {
          // Append to existing string if the last part is a string literal
          const lastPart = parts[parts.length - 1];
          if (t.isStringLiteral(lastPart)) {
            lastPart.value += ` ${staticValue}`;
          } else {
            parts.push(t.stringLiteral(` ${staticValue}`));
          }
        }
      }
      hasOptimizations = true;
      continue;
    }

    // Try to optimize logical expressions
    if (t.isLogicalExpression(arg) && arg.operator === '&&') {
      const rightValue = getStaticStringValue(arg.right);
      if (rightValue !== null && rightValue !== '') {
        const ternary = t.conditionalExpression(
          arg.left,
          t.stringLiteral(parts.length === 0 ? rightValue : ` ${rightValue}`),
          t.stringLiteral('')
        );
        parts.push(ternary);
        hasOptimizations = true;
        continue;
      }
    }

    // Try to optimize object expressions
    if (t.isObjectExpression(arg)) {
      const objectOptimization = tryOptimizeObjectExpression(arg, parts.length === 0);
      if (objectOptimization !== null) {
        parts.push(objectOptimization);
        hasOptimizations = true;
        continue;
      }
    }

    // Cannot optimize this argument
    return null;
  }

  if (!hasOptimizations || parts.length === 0) {
    return null;
  }

  if (parts.length === 0) return null;

  if (parts.length === 1) {
    return parts[0]!;
  }

  // Build concatenation expression
  let result = parts[0]!;
  for (let i = 1; i < parts.length; i++) {
    result = t.binaryExpression('+', result, parts[i]!);
  }

  return result;
}

/**
 * Attempts to optimize an object expression like { active: true, disabled: false }
 */
function tryOptimizeObjectExpression(obj: t.ObjectExpression, isFirst: boolean): t.Expression | null {
  const staticClasses: string[] = [];
  const dynamicParts: t.ConditionalExpression[] = [];

  for (const prop of obj.properties) {
    if (!t.isObjectProperty(prop) || prop.computed || !t.isIdentifier(prop.key)) {
      return null; // Cannot optimize computed or complex properties
    }

    const className = prop.key.name;
    const value = prop.value;

    if (t.isBooleanLiteral(value)) {
      if (value.value) {
        staticClasses.push(className);
      }
      // false values are ignored
    } else if (t.isExpression(value)) {
      // Dynamic boolean value
      const prefix = staticClasses.length === 0 && dynamicParts.length === 0 && isFirst ? '' : ' ';
      const ternary = t.conditionalExpression(
        value,
        t.stringLiteral(prefix + className),
        t.stringLiteral('')
      );
      dynamicParts.push(ternary);
    } else {
      return null; // Cannot optimize
    }
  }

  if (staticClasses.length === 0 && dynamicParts.length === 0) {
    return t.stringLiteral('');
  }

  const parts: t.Expression[] = [];

  if (staticClasses.length > 0) {
    const staticStr = staticClasses.join(' ');
    parts.push(t.stringLiteral(isFirst ? staticStr : ` ${staticStr}`));
  }

  parts.push(...dynamicParts);

  if (parts.length === 0) return null;

  if (parts.length === 1) {
    return parts[0]!;
  }

  // Build concatenation
  let result = parts[0]!;
  for (let i = 1; i < parts.length; i++) {
    result = t.binaryExpression('+', result, parts[i]!);
  }

  return result;
}

/**
 * Extracts a static string value from an expression, or returns null if not static
 */
function getStaticStringValue(expr: t.Expression): string | null {
  if (t.isStringLiteral(expr)) {
    return expr.value;
  }

  if (t.isNumericLiteral(expr)) return expr.value.toString();

  if (t.isBooleanLiteral(expr)) {
    return expr.value ? 'true' : '';
  }

  if (t.isNullLiteral(expr)) return '';

  if (t.isIdentifier(expr) && expr.name === 'undefined') {
    return '';
  }

  return null;
}

/**
 * Checks if an expression represents a falsy value that should be filtered out
 */
function isFalsyExpression(expr: t.Expression): boolean {
  if (t.isBooleanLiteral(expr) && !expr.value) {
    return true;
  }

  if (t.isNullLiteral(expr)) return true;

  if (t.isIdentifier(expr) && expr.name === 'undefined') {
    return true;
  }

  if (t.isStringLiteral(expr) && expr.value === '') {
    return true;
  }

  if (t.isNumericLiteral(expr) && expr.value === 0) {
    return true;
  }

  return false;
}