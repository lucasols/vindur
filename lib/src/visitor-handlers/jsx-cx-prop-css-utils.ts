import type { NodePath } from '@babel/core';
import { types as t } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import type { VindurPluginState } from '../babel-plugin';
import { TransformWarning } from '../custom-errors';
import { findWithNarrowing } from '../utils';

export function generateMissingCssClassWarnings(
  styledComponentName: string,
  classNameMappings: Array<{
    original: string;
    hashed: string;
    wasDollarPrefixed?: boolean;
  }>,
  state: VindurPluginState,
  path: NodePath<t.JSXElement>,
  onWarning?: (warning: TransformWarning) => void,
): void {
  // Get the styled component info to find its CSS class name
  const styledInfo = state.styledComponents.get(styledComponentName);
  if (!styledInfo) return;

  // Find missing CSS classes by checking for original class names
  // Exclude $ prefixed props from missing class checking
  const missingClasses: string[] = [];

  for (const mapping of classNameMappings) {
    // Skip $ prefixed props (they were originally prefixed with $)
    if (mapping.wasDollarPrefixed) continue;

    // Check if the CSS class exists in any CSS rule for this styled component
    // Look for original pattern first, then any hashed pattern that starts with the original
    const hasClass = state.cssRules.some(
      (rule) => {
        if (!rule.css.includes(`.${styledInfo.className}`)) return false;
        
        // Check for original pattern (for non-processed CSS)
        if (rule.css.includes(`&.${mapping.original}`)) return true;
        
        // Check for any hashed pattern that contains the original name 
        // This handles cases where the hashed class name might be different between usages
        const hashedPattern = new RegExp(`&\\.v\\w+-\\d+-${mapping.original}\\b`);
        return hashedPattern.test(rule.css);
      },
    );

    if (!hasClass) {
      missingClasses.push(mapping.original);
    }
  }

  // Generate warning if there are missing classes
  if (missingClasses.length > 0 && onWarning) {
    const warningMessage = `Warning: Missing CSS classes for cx modifiers in ${styledComponentName}: ${missingClasses.join(', ')}`;
    
    const warning = new TransformWarning(
      warningMessage,
      notNullish(path.node.loc),
    );
    onWarning(warning);
  }
}

export function updateStyledComponentCss(
  styledComponentName: string,
  classNameMappings: Array<{
    original: string;
    hashed: string;
    wasDollarPrefixed?: boolean;
  }>,
  state: VindurPluginState,
): void {
  // Get the styled component info to find its CSS class name
  const styledInfo = state.styledComponents.get(styledComponentName);
  if (!styledInfo) return;

  // Update CSS rules that contain the styled component's class name
  for (let i = 0; i < state.cssRules.length; i++) {
    const rule = state.cssRules[i];
    if (rule?.css.includes(`.${styledInfo.className}`)) {
      let updatedRule = rule.css;
      for (const mapping of classNameMappings) {
        // Replace &.className with &.hashedClassName
        const selectorPattern = new RegExp(
          `&\\.${escapeRegExp(mapping.original)}\\b`,
          'g',
        );
        updatedRule = updatedRule.replace(
          selectorPattern,
          `&.${mapping.hashed}`,
        );
      }
      state.cssRules[i] = { ...rule, css: updatedRule };
    }
  }
}

export function updateCssRulesForElement(
  path: NodePath<t.JSXElement>,
  classNameMappings: Array<{ original: string; hashed: string }>,
  state: VindurPluginState,
): void {
  // Check for className attributes that reference CSS variables
  const attributes = path.node.openingElement.attributes;
  const classNameAttr = findWithNarrowing(attributes, (attr) => {
    if (
      t.isJSXAttribute(attr)
      && t.isJSXIdentifier(attr.name)
      && attr.name.name === 'className'
    ) {
      return attr;
    }
    return false;
  });

  if (classNameAttr && t.isJSXExpressionContainer(classNameAttr.value)) {
    const expression = classNameAttr.value.expression;

    // Check if this references a CSS variable
    if (t.isIdentifier(expression)) {
      const cssVariable = state.cssVariables.get(expression.name);
      if (cssVariable) {
        updateCssRulesByClassName(cssVariable.className, classNameMappings, state);
        return;
      }
    }
  }

  // Check for CSS prop generated rules
  // CSS props generate class names like "v1560qbr-1-css-prop-1"
  // We'll look for CSS rules that match this pattern and contain our selectors
  for (let i = 0; i < state.cssRules.length; i++) {
    const rule = state.cssRules[i];
    if (rule?.css.includes('css-prop-')) {
      // Check if this rule contains any of our original class names
      const hasMatchingSelector = classNameMappings.some((mapping) =>
        rule.css.includes(`&.${mapping.original}`),
      );

      if (hasMatchingSelector) {
        let updatedRule = rule.css;
        for (const mapping of classNameMappings) {
          const selectorPattern = new RegExp(
            `&\\.${escapeRegExp(mapping.original)}\\b`,
            'g',
          );
          updatedRule = updatedRule.replace(
            selectorPattern,
            `&.${mapping.hashed}`,
          );
        }
        state.cssRules[i] = { ...rule, css: updatedRule };
      }
    }
  }
}

function updateCssRulesByClassName(
  cssClassName: string,
  classNameMappings: Array<{ original: string; hashed: string }>,
  state: VindurPluginState,
): void {
  // Update CSS rules that contain the CSS variable's class name
  for (let i = 0; i < state.cssRules.length; i++) {
    const rule = state.cssRules[i];
    if (rule?.css.includes(`.${cssClassName}`)) {
      let updatedRule = rule.css;
      for (const mapping of classNameMappings) {
        // Replace &.className with &.hashedClassName
        const selectorPattern = new RegExp(
          `&\\.${escapeRegExp(mapping.original)}\\b`,
          'g',
        );
        updatedRule = updatedRule.replace(
          selectorPattern,
          `&.${mapping.hashed}`,
        );
      }
      state.cssRules[i] = { ...rule, css: updatedRule };
    }
  }
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
