import { types as t, type NodePath } from '@babel/core';
import { notNullish } from '@ls-stack/utils/assertions';
import { murmur2 } from '@ls-stack/utils/hash';
import { TransformError } from '../custom-errors';

export type StyleFlag =
  | { propName: string; hashedClassName: string; type: 'boolean' }
  | {
      propName: string;
      hashedClassName: string;
      type: 'string-union';
      unionValues: string[];
    };

/**
 * Find a type alias declaration in the program
 */
function findTypeAliasDeclaration(
  path: NodePath,
  typeName: string,
): t.TSTypeAliasDeclaration | null {
  const program = path.findParent((p) => p.isProgram());
  if (!program || !t.isProgram(program.node)) return null;

  for (const statement of program.node.body) {
    if (
      t.isTSTypeAliasDeclaration(statement)
      && t.isIdentifier(statement.id)
      && statement.id.name === typeName
    ) {
      return statement;
    }
  }
  return null;
}

/**
 * Resolve a type reference to its actual type, with support for simple string literal unions only
 */
function resolveTypeReference(
  path: NodePath,
  typeRef: t.TSTypeReference,
): t.TSType | null {
  if (!t.isIdentifier(typeRef.typeName)) return null;

  const typeName = typeRef.typeName.name;
  const typeAlias = findTypeAliasDeclaration(path, typeName);

  if (!typeAlias) return null;

  return typeAlias.typeAnnotation;
}

/**
 * Process a nested type reference within a property signature
 */
function processNestedTypeReference(
  path: NodePath,
  typeAnnotation: t.TSTypeReference,
  propName: string,
  member: t.TSPropertySignature,
  fileHash: string,
  dev: boolean,
): StyleFlag {
  const resolvedType = resolveTypeReference(path, typeAnnotation);

  if (!resolvedType) {
    const typeName = t.isIdentifier(typeAnnotation.typeName)
      ? typeAnnotation.typeName.name
      : 'unknown';
    throw new TransformError(
      `Type "${typeName}" not found. Only locally defined types are supported for style flags`,
      notNullish(member.loc),
    );
  }

  // Check if the resolved type is a valid string literal union
  if (t.isTSUnionType(resolvedType)) {
    const unionValues: string[] = [];
    let isStringUnion = true;

    for (const unionType of resolvedType.types) {
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
      const hashedClassName = generateHashedClassName(
        propName,
        fileHash,
        dev,
      );
      return {
        propName,
        hashedClassName,
        type: 'string-union',
        unionValues,
      };
    } else {
      const typeString = getTypeString(resolvedType);
      throw new TransformError(
        `Referenced type must be a string literal union. Property "${propName}" references type "${typeString}" which is not supported`,
        notNullish(member.loc),
      );
    }
  } else if (t.isTSBooleanKeyword(resolvedType)) {
    // Handle boolean type references
    const hashedClassName = generateHashedClassName(
      propName,
      fileHash,
      dev,
    );
    return { propName, hashedClassName, type: 'boolean' };
  } else {
    // For other resolved types, throw an error
    const typeString = getTypeString(resolvedType);
    throw new TransformError(
      `Referenced type must be a boolean or string literal union. Property "${propName}" references type "${typeString}" which is not supported`,
      notNullish(member.loc),
    );
  }
}

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
  path?: NodePath,
): StyleFlag[] | undefined {
  if (!typeParameters || typeParameters.params.length === 0) {
    return undefined;
  }

  // Only handle TypeScript type parameters, not Flow
  if (!t.isTSTypeParameterInstantiation(typeParameters)) {
    return undefined;
  }

  const firstParam = typeParameters.params[0];

  let typeLiteral: t.TSTypeLiteral;

  if (t.isTSTypeLiteral(firstParam)) {
    // Direct type literal
    typeLiteral = firstParam;
  } else if (t.isTSTypeReference(firstParam)) {
    // Type reference - resolve to type alias
    if (!path) {
      throw new TransformError(
        'Cannot resolve type references without path context',
        notNullish(typeParameters.loc),
      );
    }

    if (!t.isIdentifier(firstParam.typeName)) {
      throw new TransformError(
        'Only simple type references are supported for style flags',
        notNullish(firstParam.loc),
      );
    }

    const typeName = firstParam.typeName.name;
    const typeAlias = findTypeAliasDeclaration(path, typeName);

    if (!typeAlias) {
      throw new TransformError(
        `Type "${typeName}" not found. Only locally defined types are supported for style flags`,
        notNullish(firstParam.loc),
        { ignoreInLint: true },
      );
    }

    if (!t.isTSTypeLiteral(typeAlias.typeAnnotation)) {
      throw new TransformError(
        `Type "${typeName}" must be a simple object type for style flags. Complex types like unions, intersections, or imported types are not supported`,
        notNullish(firstParam.loc),
      );
    }

    typeLiteral = typeAlias.typeAnnotation;
  } else {
    // Invalid inline type - throw descriptive error
    const typeString = firstParam ? getTypeString(firstParam) : 'unknown';
    throw new TransformError(
      `Style flags only support simple object types like "{ prop: boolean }" or type references. Complex inline types like "${typeString}" are not supported`,
      notNullish(firstParam?.loc ?? typeParameters.loc),
    );
  }

  const styleProps: StyleFlag[] = [];

  for (const member of typeLiteral.members) {
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
      } else if (t.isTSTypeReference(typeAnnotation)) {
        // Handle nested type references (e.g., levels: Levels)
        if (!path) {
          throw new TransformError(
            'Cannot resolve type references without path context',
            notNullish(member.loc),
          );
        }

        const styleFlag = processNestedTypeReference(
          path,
          typeAnnotation,
          propName,
          member,
          fileHash,
          dev,
        );
        styleProps.push(styleFlag);
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
          throw new TransformError(
            `Style flags only support boolean properties and string literal unions. Property "${propName}" has type "${typeString}".`,
            notNullish(member.loc),
          );
        }
      } else {
        // For non-boolean, non-union types, throw an error
        const typeString = getTypeString(typeAnnotation);
        throw new TransformError(
          `Style flags only support boolean properties and string literal unions. Property "${propName}" has type "${typeString}".`,
          notNullish(member.loc),
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
  } else if (t.isTSIntersectionType(typeNode)) {
    const types = typeNode.types.map(getTypeString);
    return types.join(' & ');
  } else if (t.isTSLiteralType(typeNode)) {
    if (t.isStringLiteral(typeNode.literal)) {
      return `"${typeNode.literal.value}"`;
    } else if (t.isNumericLiteral(typeNode.literal)) {
      return typeNode.literal.value.toString();
    } else if (t.isBooleanLiteral(typeNode.literal)) {
      return typeNode.literal.value.toString();
    }
  } else if (t.isTSTypeLiteral(typeNode)) {
    return '{ ... }';
  } else if (t.isTSTypeReference(typeNode)) {
    if (t.isIdentifier(typeNode.typeName)) {
      return typeNode.typeName.name;
    }
    return 'TypeReference';
  } else if (t.isTSArrayType(typeNode)) {
    return `${getTypeString(typeNode.elementType)}[]`;
  } else if (t.isTSTupleType(typeNode)) {
    const elements = typeNode.elementTypes.map((element) => {
      if (t.isTSType(element)) {
        return getTypeString(element);
      }
      // Handle TSNamedTupleMember
      return '...';
    });
    return `[${elements.join(', ')}]`;
  }
  return 'unknown';
}

/**
 * Update CSS rules to replace class selectors with hashed versions for style flags
 */
export function updateCssSelectorsForStyleFlags(
  styleFlags: StyleFlag[],
  cssRules: Array<{ css: string }>,
  styledClassName: string,
): void {
  for (let i = 0; i < cssRules.length; i++) {
    const rule = cssRules[i];
    if (rule?.css.includes(styledClassName)) {
      let updatedRule = rule.css;

      for (const styleProp of styleFlags) {
        if (styleProp.type === 'boolean') {
          // Replace .propName with .hashedClassName for boolean props (anywhere in CSS)
          const selectorPattern = new RegExp(
            `\\.${escapeRegExp(styleProp.propName)}\\b`,
            'g',
          );
          updatedRule = updatedRule.replace(
            selectorPattern,
            `.${styleProp.hashedClassName}`,
          );
        } else {
          // Replace .propName-value with .hashedClassName-value for string union props (anywhere in CSS)
          for (const value of styleProp.unionValues) {
            const selectorPattern = new RegExp(
              `\\.${escapeRegExp(styleProp.propName)}-${escapeRegExp(value)}\\b`,
              'g',
            );
            updatedRule = updatedRule.replace(
              selectorPattern,
              `.${styleProp.hashedClassName}-${value}`,
            );
          }
        }
      }

      cssRules[i] = { ...rule, css: updatedRule };
    }
  }
}

/**
 * Check for missing modifier styles in CSS rules
 */
export function checkForMissingModifierStyles(
  styleFlags: StyleFlag[],
  cssRules: Array<{ css: string }>,
  styledClassName: string,
): Array<{ propName: string; original: string; expected: string }> {
  const missingSelectors: Array<{
    propName: string;
    original: string;
    expected: string;
  }> = [];

  // Find the CSS rule for this styled component
  const relevantRule = cssRules.find((rule) =>
    rule.css.includes(styledClassName),
  );
  if (!relevantRule) return missingSelectors;

  // Remove CSS comments to avoid false positives
  const ruleWithoutComments = relevantRule.css.replace(/\/\*[\s\S]*?\*\//g, '');

  for (const styleProp of styleFlags) {
    if (styleProp.type === 'boolean') {
      // Check for .propName selector (anywhere in CSS, including &.propName)
      const originalSelector = `&.${styleProp.propName}`;
      const expectedSelector = `&.${styleProp.hashedClassName}`;
      const selectorPattern = new RegExp(`\\.${escapeRegExp(styleProp.propName)}\\b`);

      if (
        !ruleWithoutComments.includes(originalSelector)
        && !ruleWithoutComments.includes(expectedSelector)
        && !selectorPattern.test(ruleWithoutComments)
      ) {
        missingSelectors.push({
          propName: styleProp.propName,
          original: originalSelector,
          expected: expectedSelector,
        });
      }
    } else {
      // Check for .propName-value selectors (string-union type, anywhere in CSS)
      for (const value of styleProp.unionValues) {
        const originalSelector = `&.${styleProp.propName}-${value}`;
        const expectedSelector = `&.${styleProp.hashedClassName}-${value}`;
        const selectorPattern = new RegExp(`\\.${escapeRegExp(styleProp.propName)}-${escapeRegExp(value)}\\b`);

        if (
          !ruleWithoutComments.includes(originalSelector)
          && !ruleWithoutComments.includes(expectedSelector)
          && !selectorPattern.test(ruleWithoutComments)
        ) {
          missingSelectors.push({
            propName: `${styleProp.propName}-${value}`,
            original: originalSelector,
            expected: expectedSelector,
          });
        }
      }
    }
  }

  return missingSelectors;
}

/**
 * Escape special regex characters
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
