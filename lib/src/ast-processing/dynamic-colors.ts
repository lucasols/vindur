import { types as t } from '@babel/core';
import type { CssProcessingContext } from '../css-processing';

export function resolveDynamicColorExpression(
  memberExpr: t.MemberExpression,
  context: CssProcessingContext,
): string | null {
  // Handle dynamic color expressions like dynamicColor.var, dynamicColor.self.isDark, etc.
  
  // Check if this is a dynamic color variable
  const rootIdentifier = getRootIdentifier(memberExpr);
  if (!rootIdentifier) return null;
  
  const dynamicColorId = context.state.dynamicColors?.get(rootIdentifier);
  if (!dynamicColorId) return null;
  
  // Parse the property chain
  const propertyChain = getPropertyChain(memberExpr);
  if (!propertyChain) return null;
  
  // Handle different dynamic color properties
  if (propertyChain.length === 1) {
    const prop = propertyChain[0];
    switch (prop) {
      case 'var':
        return `var(--${dynamicColorId})`;
      default:
        return null;
    }
  }
  
  if (propertyChain.length === 2) {
    const [category, method] = propertyChain;
    
    if (!category || !method) {
      return null;
    }
    
    if (category === 'contrast') {
      switch (method) {
        case 'var':
          return `var(--${dynamicColorId}-c)`;
        case 'optimal':
          return `var(--${dynamicColorId}-c-optimal)`;
        default:
          return null;
      }
    }
    
    if (category === 'self' || category === 'container') {
      // Map condition names to indices
      const conditionMap: Record<string, number> = {
        'isDark': 0,
        'isLight': 1,
        'isDefined': 2,
        'isNotDefined': 3,
        'isVeryDark': 4,
        'isNotVeryDark': 5,
        'isVeryLight': 6,
        'isNotVeryLight': 7,
      };
      
      const conditionIndex = conditionMap[method];
      if (conditionIndex !== undefined) {
        const shortType = category === 'self' ? 's' : 'c';
        if (category === 'self') {
          return `&.${dynamicColorId}-${shortType}${conditionIndex}`;
        } else {
          // Container selectors should just be the class name
          // The template literal will provide the ` &` part
          return `.${dynamicColorId}-${shortType}${conditionIndex}`;
        }
      }
    }
    
    return null;
  }
  
  return null;
}

export function resolveDynamicColorCallExpression(
  callExpr: t.CallExpression,
  context: CssProcessingContext,
): string | null {
  // Handle dynamic color method calls like dynamicColor.alpha(0.5), dynamicColor.darker(0.1), etc.
  
  if (!t.isMemberExpression(callExpr.callee)) return null;
  
  const rootIdentifier = getRootIdentifier(callExpr.callee);
  if (!rootIdentifier) return null;
  
  const dynamicColorId = context.state.dynamicColors?.get(rootIdentifier);
  if (!dynamicColorId) return null;
  
  const propertyChain = getPropertyChain(callExpr.callee);
  if (!propertyChain) return null;
  
  // Get the first argument (optional for some functions like optimal())
  const firstArg = callExpr.arguments[0];
  let value: number | undefined;
  
  if (firstArg && t.isNumericLiteral(firstArg)) {
    value = firstArg.value;
  }
  
  if (propertyChain.length === 1) {
    const method = propertyChain[0];
    
    if (!method) return null;
    
    switch (method) {
      case 'alpha':
        if (value === undefined) throw new Error(`Method ${method} requires a numeric argument`);
        return `color-mix(in srgb, var(--${dynamicColorId}) ${value * 100}%, transparent)`;
      case 'darker':
        if (value === undefined) throw new Error(`Method ${method} requires a numeric argument`);
        return `color-mix(in srgb, var(--${dynamicColorId}) ${(1 - value) * 100}%, #000)`;
      case 'lighter':
        if (value === undefined) throw new Error(`Method ${method} requires a numeric argument`);
        return `color-mix(in srgb, var(--${dynamicColorId}) ${(1 - value) * 100}%, #fff)`;
      case 'saturatedDarker':
        if (value === undefined) throw new Error(`Method ${method} requires a numeric argument`);
        return `color-mix(in srgb, var(--${dynamicColorId}) ${(1 - value) * 100}%, hsl(from var(--${dynamicColorId}) h 100% 20%))`;
      default:
        return null;
    }
  }
  
  if (propertyChain.length === 2) {
    const [category, method] = propertyChain;
    
    if (category === 'contrast') {
      switch (method) {
        case 'alpha':
          if (value === undefined) throw new Error(`Method ${method} requires a numeric argument`);
          return `color-mix(in srgb, var(--${dynamicColorId}-c) ${value * 100}%, transparent)`;
        case 'optimal':
          // Handle optimal() with no arguments or optimal({ alpha: 0.6 })
          if (callExpr.arguments.length === 0) {
            return `var(--${dynamicColorId}-c-optimal)`;
          }
          
          if (callExpr.arguments.length > 0 && t.isObjectExpression(firstArg)) {
            // Handle optimal({ alpha: 0.6 }) case
            const alphaProp = firstArg.properties.find(
              (prop): prop is t.ObjectProperty => 
                t.isObjectProperty(prop) && 
                t.isIdentifier(prop.key) && 
                prop.key.name === 'alpha'
            );
            
            if (alphaProp && t.isNumericLiteral(alphaProp.value)) {
              const alphaValue = alphaProp.value.value;
              return `color-mix(in srgb, var(--${dynamicColorId}-c-optimal) ${alphaValue * 100}%, transparent)`;
            }
          }
          return `var(--${dynamicColorId}-c-optimal)`;
        default:
          return null;
      }
    }
  }
  
  return null;
}

// Helper function to get the root identifier from a member expression
function getRootIdentifier(expr: t.MemberExpression): string | null {
  let current: t.Expression = expr;
  
  while (t.isMemberExpression(current)) {
    current = current.object;
  }
  
  if (t.isIdentifier(current)) {
    return current.name;
  }
  
  return null;
}

// Helper function to get the property chain from a member expression
function getPropertyChain(expr: t.MemberExpression): string[] | null {
  const chain: string[] = [];
  let current: t.Expression = expr;
  
  while (t.isMemberExpression(current)) {
    if (!t.isIdentifier(current.property) || current.computed) {
      return null;
    }
    chain.unshift(current.property.name);
    current = current.object;
  }
  
  return chain;
}