import { types as t } from '@babel/core';
import { murmur2 } from '@ls-stack/utils/hash';

type StyleFlag =
  | { propName: string; hashedClassName: string; type: 'boolean' }
  | {
      propName: string;
      hashedClassName: string;
      type: 'string-union';
      unionValues: string[];
    };

/**
 * Extract boolean and string union properties from TypeScript generic type parameters
 */
export function extractStyleFlags(
  typeParameters:
    | t.TSTypeParameterInstantiation
    | t.TypeParameterInstantiation
    | null,
  fileHash: string,
  dev: boolean,
): StyleFlag[] | undefined {
  if (!typeParameters || typeParameters.params.length === 0) {
    return undefined;
  }

  // Only handle TypeScript type parameters, not Flow
  if (!t.isTSTypeParameterInstantiation(typeParameters)) {
    return undefined;
  }

  const firstParam = typeParameters.params[0];
  if (!t.isTSTypeLiteral(firstParam)) return undefined;

  const styleProps: StyleFlag[] = [];

  for (const member of firstParam.members) {
    if (
      t.isTSPropertySignature(member)
      && t.isIdentifier(member.key)
      && member.typeAnnotation
      && t.isTSTypeAnnotation(member.typeAnnotation)
    ) {
      const propName = member.key.name;
      const typeAnnotation = member.typeAnnotation.typeAnnotation;

      // Check if it's a boolean type
      if (t.isTSBooleanKeyword(typeAnnotation)) {
        const hashedClassName = generateHashedClassName(
          propName,
          fileHash,
          dev,
        );
        styleProps.push({ propName, hashedClassName, type: 'boolean' });
      } else if (t.isTSUnionType(typeAnnotation)) {
        // Check if it's a string literal union (e.g., 'small' | 'large')
        const unionValues: string[] = [];
        let isStringUnion = true;

        for (const unionType of typeAnnotation.types) {
          if (
            t.isTSLiteralType(unionType)
            && t.isStringLiteral(unionType.literal)
          ) {
            unionValues.push(unionType.literal.value);
          } else {
            isStringUnion = false;
            break;
          }
        }

        if (isStringUnion && unionValues.length > 0) {
          // Generate base hashed class name for the prop
          const hashedClassName = generateHashedClassName(
            propName,
            fileHash,
            dev,
          );
          styleProps.push({
            propName,
            hashedClassName,
            type: 'string-union',
            unionValues,
          });
        } else {
          // For non-string-literal unions, we should ignore them or throw an error
          // According to the spec, we should throw an error for unsupported types
          const typeString = getTypeString(typeAnnotation);
          throw new Error(
            `Style flags only support boolean properties and string literal unions. Property "${propName}" has type "${typeString}".`,
          );
        }
      } else {
        // For non-boolean, non-union types, throw an error
        const typeString = getTypeString(typeAnnotation);
        throw new Error(
          `Style flags only support boolean properties and string literal unions. Property "${propName}" has type "${typeString}".`,
        );
      }
    }
  }

  return styleProps.length > 0 ? styleProps : undefined;
}

/**
 * Generate hashed class name for style flags
 */
function generateHashedClassName(
  propName: string,
  fileHash: string,
  dev: boolean,
): string {
  const hash = murmur2(`${fileHash}-${propName}`);
  return dev ? `v${hash}-${propName}` : `v${hash}`;
}

/**
 * Get string representation of TypeScript type for error messages
 */
function getTypeString(typeNode: t.TSType): string {
  if (t.isTSBooleanKeyword(typeNode)) {
    return 'boolean';
  } else if (t.isTSStringKeyword(typeNode)) {
    return 'string';
  } else if (t.isTSNumberKeyword(typeNode)) {
    return 'number';
  } else if (t.isTSUnionType(typeNode)) {
    const types = typeNode.types.map(getTypeString);
    return types.join(' | ');
  } else if (t.isTSLiteralType(typeNode)) {
    if (t.isStringLiteral(typeNode.literal)) {
      return `"${typeNode.literal.value}"`;
    } else if (t.isNumericLiteral(typeNode.literal)) {
      return typeNode.literal.value.toString();
    } else if (t.isBooleanLiteral(typeNode.literal)) {
      return typeNode.literal.value.toString();
    }
  }
  return 'unknown';
}

/**
 * Update CSS rules to replace class selectors with hashed versions for style flags
 */
export function updateCssSelectorsForStyleFlags(
  styleFlags: StyleFlag[],
  cssRules: string[],
  styledClassName: string,
): void {
  for (let i = 0; i < cssRules.length; i++) {
    const rule = cssRules[i];
    if (rule?.includes(styledClassName)) {
      let updatedRule = rule;

      for (const styleProp of styleFlags) {
        if (styleProp.type === 'boolean') {
          // Replace &.propName with &.hashedClassName for boolean props
          const selectorPattern = new RegExp(
            `&\\.${escapeRegExp(styleProp.propName)}\\b`,
            'g',
          );
          updatedRule = updatedRule.replace(
            selectorPattern,
            `&.${styleProp.hashedClassName}`,
          );
        } else {
          // Replace &.propName-value with &.hashedClassName-value for string union props
          for (const value of styleProp.unionValues) {
            const selectorPattern = new RegExp(
              `&\\.${escapeRegExp(styleProp.propName)}-${escapeRegExp(value)}\\b`,
              'g',
            );
            updatedRule = updatedRule.replace(
              selectorPattern,
              `&.${styleProp.hashedClassName}-${value}`,
            );
          }
        }
      }

      cssRules[i] = updatedRule;
    }
  }
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
